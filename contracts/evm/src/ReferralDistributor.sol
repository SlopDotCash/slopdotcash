// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IReferralToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice Cumulative Merkle distributor for the referral program (PRD section 11).
/// Roots are immediately claimable. The owner may void the latest root only before its first successful
/// claim. Referrers pull their own tokens; nobody pushes a transfer or holds a recipient list.
/// @dev The poster chooses the root and declared total. There is no protected intervention window: a
/// compromised poster can win the race to a claim, and paid tokens cannot be clawed back. The independent
/// watcher, separate owner key, pause, growth cap, post spacing and full funding checks remain required.
/// The owner may rescue only after RESCUE_DELAY without a new live root or unpause. A void does not shorten
/// that delay. Token transfers must be exact. All timing uses block.timestamp, never block.number.
contract ReferralDistributor {
    struct Epoch {
        bytes32 root;
        uint256 total;
        uint64 postedAt;
        bool voided;
    }

    /// @notice Claims are eligible immediately; retained for deployment/read compatibility.
    uint64 public constant CLAIM_DELAY = 0;
    /// @notice The owner may sweep the balance only after this long with no live root and no unpause.
    uint64 public constant RESCUE_DELAY = 365 days;

    IReferralToken public immutable token;
    /// @notice Most the declared total may exceed the highest total ever posted, in token base units.
    uint256 public immutable epochCap;
    /// @notice Least time between two posts that are not voided.
    uint64 public immutable postSpacing;

    address public owner;
    address public pendingOwner;
    address public poster;
    bool public paused;
    /// @dev A successful claim after the latest post permanently seals that root against voiding.
    bool private latestRootClaimed;

    Epoch[] private epochs;
    /// @notice Root claims are verified against: the latest non-voided epoch.
    bytes32 public activeRoot;
    /// @notice Declared total of the active root. Claims never exceed it in sum.
    uint256 public activeTotal;
    /// @dev Index of the active epoch, or NONE.
    uint256 private activeIndex = NONE;
    uint256 private constant NONE = type(uint256).max;
    /// @notice Highest declared total ever posted and not voided; the cap is measured from here.
    uint256 public highWaterTotal;

    uint256 public totalClaimed;
    mapping(address => uint256) public claimed;
    /// @notice When the latest non-voided root was posted; postSpacing is measured from here.
    uint64 public lastLivePostedAt;
    /// @notice When the active root went live, or deployment; rescue counts from the later of this and lastUnpausedAt.
    uint64 public lastLiveAt;
    uint64 public lastUnpausedAt;

    event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt);
    event RootVoided(uint256 indexed epoch, bytes32 root);
    event RootActivated(uint256 indexed epoch, bytes32 root, uint256 total);
    event Claimed(address indexed account, uint256 indexed epoch, uint256 amount, uint256 cumulative);
    event PosterChanged(address indexed previousPoster, address indexed newPoster);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account, uint256 indexed extendedEpoch, uint64 newClaimableAt);
    event Rescued(address indexed to, uint256 amount);

    error NotOwner();
    error NotPoster();
    error NotPendingOwner();
    error IsPaused();
    error InvalidInput();
    error EpochOutOfOrder(uint256 expected);
    error RootPending();
    error TooSoon(uint64 earliest);
    error CapExceeded();
    error BelowClaimed();
    error Underfunded();
    error WindowClosed();
    error AlreadyVoided();
    error NoActiveRoot();
    error InvalidProof();
    error NothingToClaim();
    error TotalExceeded();
    error RescueTooEarly(uint64 earliest);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(IReferralToken token_, address owner_, address poster_, uint256 epochCap_, uint64 postSpacing_) {
        if (
            address(token_) == address(0) || owner_ == address(0) || poster_ == address(0) || owner_ == poster_
                || epochCap_ == 0 || postSpacing_ > RESCUE_DELAY
        ) {
            revert InvalidInput();
        }
        token = token_;
        owner = owner_;
        poster = poster_;
        epochCap = epochCap_;
        postSpacing = postSpacing_;
        lastLiveAt = uint64(block.timestamp);
        lastUnpausedAt = uint64(block.timestamp);
        emit OwnershipTransferred(address(0), owner_);
        emit PosterChanged(address(0), poster_);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function epochCount() external view returns (uint256) {
        return epochs.length;
    }

    function epochAt(uint256 index) external view returns (Epoch memory) {
        return epochs[index];
    }

    /// @notice The epoch index the next postRoot must use.
    function nextEpoch() external view returns (uint256) {
        return epochs.length;
    }

    /// @notice When claims against epoch `index` became eligible.
    function claimableAt(uint256 index) public view returns (uint64) {
        return epochs[index].postedAt;
    }

    /// @notice No root waits for a claim-delay window under this contract revision.
    function hasPendingRoot() public pure returns (bool) {
        return false;
    }

    /// @notice The root claims would verify against now, its declared total and its epoch index (NONE if none).
    function currentRoot() external view returns (bytes32 root, uint256 total, uint256 index) {
        return liveRoot();
    }

    /// @notice Earliest moment the owner may rescue, given the state so far.
    function rescueAvailableAt() public view returns (uint64) {
        (,, uint256 index) = liveRoot();
        uint64 liveAt = lastLiveAt;
        if (index != NONE && index != activeIndex) liveAt = epochs[index].postedAt;
        // Even a subsequently voided immediate root cannot shorten the rescue wait.
        if (epochs.length > 0 && epochs[epochs.length - 1].postedAt > liveAt) {
            liveAt = epochs[epochs.length - 1].postedAt;
        }
        uint64 since = liveAt > lastUnpausedAt ? liveAt : lastUnpausedAt;
        return since + RESCUE_DELAY;
    }

    /// @notice Leaf hash of one claimant, as the off-chain accrual file builds it.
    function leaf(address account, uint256 cumulative) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))));
    }

    /// @notice What `account` could claim now against the root that claims verify against, or zero.
    function claimable(address account, uint256 cumulative, bytes32[] calldata proof) external view returns (uint256) {
        (bytes32 root, uint256 total,) = liveRoot();
        if (root == bytes32(0) || !verify(proof, root, leaf(account, cumulative))) return 0;
        uint256 already = claimed[account];
        if (cumulative <= already) return 0;
        uint256 amount = cumulative - already;
        return totalClaimed + amount <= total ? amount : 0;
    }

    /// @dev The latest non-voided root is immediately eligible.
    function liveRoot() internal view returns (bytes32 root, uint256 total, uint256 index) {
        uint256 i = epochs.length;
        while (i > 0) {
            i -= 1;
            Epoch storage candidate = epochs[i];
            if (!candidate.voided) return (candidate.root, candidate.total, i);
        }
        return (bytes32(0), 0, NONE);
    }

    // ------------------------------------------------------------------
    // Poster
    // ------------------------------------------------------------------

    /// @notice Posts the next epoch. Refused sooner than postSpacing after the last non-voided post,
    /// when the total falls below what was already
    /// claimed, when it exceeds the highest posted total by more than epochCap, or when the balance plus what
    /// was already claimed does not cover it. Claims are eligible immediately.
    function postRoot(uint256 index, bytes32 root, uint256 newTotal) external whenNotPaused {
        if (msg.sender != poster) revert NotPoster();
        if (index != epochs.length) revert EpochOutOfOrder(epochs.length);
        if (root == bytes32(0)) revert InvalidInput();
        uint64 earliest = lastLivePostedAt + postSpacing;
        if (lastLivePostedAt != 0 && block.timestamp < earliest) revert TooSoon(earliest);
        activate();
        if (newTotal < totalClaimed) revert BelowClaimed();
        if (newTotal > highWaterTotal + epochCap) revert CapExceeded();
        if (token.balanceOf(address(this)) + totalClaimed < newTotal) revert Underfunded();
        uint64 now64 = uint64(block.timestamp);
        epochs.push(Epoch({root: root, total: newTotal, postedAt: now64, voided: false}));
        lastLivePostedAt = now64;
        latestRootClaimed = false;
        if (newTotal > highWaterTotal) highWaterTotal = newTotal;
        emit RootPosted(index, root, newTotal, now64 + CLAIM_DELAY);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    /// @notice Drops the latest root only before its first successful claim. The previous root becomes
    /// claimable again, with all earlier claim counters preserved. Works while paused; no token is recovered.
    function voidRoot(uint256 index) external onlyOwner {
        if (epochs.length == 0 || index != epochs.length - 1) revert EpochOutOfOrder(epochs.length);
        Epoch storage last = epochs[index];
        if (last.voided) revert AlreadyVoided();
        if (latestRootClaimed) revert WindowClosed();
        last.voided = true;
        // The spacing and high-water marks follow the latest non-voided post.
        (lastLivePostedAt, highWaterTotal) = previousLiveMarks(index);
        activate();
        emit RootVoided(index, last.root);
    }

    /// @dev Post time and declared total of the latest non-voided epoch before `index`, or the active values.
    function previousLiveMarks(uint256 index) internal view returns (uint64 postedAt, uint256 total) {
        uint256 i = index;
        while (i > 0) {
            i -= 1;
            Epoch storage candidate = epochs[i];
            if (!candidate.voided) return (candidate.postedAt, candidate.total);
        }
        return (0, 0);
    }

    /// @notice Blocks posts, claims and rescue. An unclaimed latest root remains voidable.
    function pause() external onlyOwner {
        if (paused) revert InvalidInput();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resumes immediately; pause never creates or extends a claim delay.
    function unpause() external onlyOwner {
        if (!paused) revert InvalidInput();
        paused = false;
        lastUnpausedAt = uint64(block.timestamp);
        emit Unpaused(msg.sender, NONE, 0);
    }

    function setPoster(address newPoster) external onlyOwner {
        // The pending owner may not become the poster either, so one key never holds both roles.
        if (newPoster == address(0) || newPoster == owner || newPoster == pendingOwner) revert InvalidInput();
        emit PosterChanged(poster, newPoster);
        poster = newPoster;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == poster) revert InvalidInput();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        // transferOwnership(address(0)) cancels a pending transfer; nobody may accept it.
        if (msg.sender != pendingOwner || msg.sender == address(0)) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Sweeps the whole balance, unclaimed amounts included, once RESCUE_DELAY has passed with no root
    /// going live and no unpause. Refused while paused, so claimants always had the full rescue delay to claim. This ends the program: later claims fail for lack of balance.
    function rescue(address to) external onlyOwner whenNotPaused {
        if (to == address(0)) revert InvalidInput();
        activate();
        uint64 earliest = rescueAvailableAt();
        if (block.timestamp < earliest) revert RescueTooEarly(earliest);
        uint256 amount = token.balanceOf(address(this));
        emit Rescued(to, amount);
        if (amount > 0 && !token.transfer(to, amount)) revert TransferFailed();
    }

    // ------------------------------------------------------------------
    // Claimants
    // ------------------------------------------------------------------

    /// @notice Pays msg.sender `cumulative` minus what it already claimed, against the active root. The sum of
    /// all claims never exceeds the active root's declared total.
    function claim(uint256 cumulative, bytes32[] calldata proof) external whenNotPaused {
        activate();
        if (activeRoot == bytes32(0)) revert NoActiveRoot();
        if (!verify(proof, activeRoot, leaf(msg.sender, cumulative))) revert InvalidProof();
        uint256 already = claimed[msg.sender];
        if (cumulative <= already) revert NothingToClaim();
        uint256 amount = cumulative - already;
        if (totalClaimed + amount > activeTotal) revert TotalExceeded();
        claimed[msg.sender] = cumulative;
        totalClaimed += amount;
        latestRootClaimed = true;
        emit Claimed(msg.sender, activeIndex, amount, cumulative);
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// @dev Promotes the latest non-voided epoch, or clears a voided root. Idempotent.
    function activate() internal {
        (bytes32 root, uint256 total, uint256 index) = liveRoot();
        if (index == activeIndex) return;
        activeRoot = root;
        activeTotal = total;
        activeIndex = index;
        if (index != NONE) {
            if (epochs[index].postedAt > lastLiveAt) lastLiveAt = epochs[index].postedAt;
            emit RootActivated(index, root, total);
        }
    }

    /// @dev Sorted-pair Merkle verification over the double-hashed leaf.
    function verify(bytes32[] calldata proof, bytes32 root, bytes32 node) internal pure returns (bool) {
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            node = node <= sibling
                ? keccak256(abi.encodePacked(node, sibling))
                : keccak256(abi.encodePacked(sibling, node));
        }
        return node == root;
    }
}
