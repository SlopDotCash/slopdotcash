// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IReferralToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice Cumulative Merkle distributor for the Slop Cash S.P. project-referral program (PRD section 11,
/// "Referral program", proposed). The contract holds one ERC-20. A bounded poster publishes one root per epoch
/// over leaves of (account, cumulative amount); each root becomes claimable CLAIM_DELAY after it is posted, and
/// the owner may void it inside that window. Referrers pull their own tokens: claim(cumulative, proof) pays
/// cumulative minus what the caller already claimed. Nobody pushes a transfer and nobody holds a recipient list.
/// @dev Trust model. The poster chooses the root and the declared total; the contract cannot see inside a root,
/// so what bounds the poster is this: a root pays nothing until CLAIM_DELAY has passed, the owner can void it in
/// that window, claims against a root can never exceed its declared total (totalClaimed <= activeTotal), the
/// declared total can grow by at most epochCap above the highest total ever posted, live posts are at least
/// postSpacing apart, and the balance plus what was already claimed must cover the total. A malicious root that
/// the owner does not void can therefore redirect at most the unclaimed part of the previous total plus one
/// epochCap; the off-chain watcher that rebuilds each root from the public accrual file is still required.
/// The owner can void a pending root, pause (which freezes the objection window of a pending root and blocks
/// posts, claims and rescue), change the poster, hand over ownership in two steps, and rescue the whole balance
/// only after RESCUE_DELAY with no root going live and no unpause. A voided epoch keeps its index so the
/// off-chain numbering never shifts. The token must have exact transfers and no transfer fee. Amounts are token
/// base units. The contract reads only block.timestamp, never block.number, so Arbitrum Nitro block semantics
/// on Robinhood Chain do not affect it.
contract ReferralDistributor {
    struct Epoch {
        bytes32 root;
        uint256 total;
        uint64 postedAt;
        bool voided;
    }

    /// @notice Objection window between a post and the first claim against it.
    uint64 public constant CLAIM_DELAY = 7 days;
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
    /// @dev When the current pause began; the pending root's window is frozen from here.
    uint64 private pausedAt;

    Epoch[] private epochs;
    /// @notice Root claims are verified against: the latest non-voided epoch whose delay has passed.
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

    /// @notice When claims against epoch `index` open, including any time the window spent frozen by a pause.
    function claimableAt(uint256 index) public view returns (uint64) {
        return windowEnd(epochs[index]);
    }

    /// @notice True while the latest epoch is posted, not voided and inside its objection window.
    function hasPendingRoot() public view returns (bool) {
        if (epochs.length == 0) return false;
        Epoch storage last = epochs[epochs.length - 1];
        return !last.voided && block.timestamp < windowEnd(last);
    }

    /// @notice The root claims would verify against now, its declared total and its epoch index (NONE if none).
    function currentRoot() external view returns (bytes32 root, uint256 total, uint256 index) {
        return liveRoot();
    }

    /// @notice Earliest moment the owner may rescue, given the state so far.
    function rescueAvailableAt() public view returns (uint64) {
        (,, uint256 index) = liveRoot();
        uint64 liveAt = lastLiveAt;
        if (index != NONE && index != activeIndex) liveAt = windowEnd(epochs[index]);
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

    /// @dev End of an epoch's objection window. While paused, a window that was still open when the pause
    /// began is frozen: it extends by the time paused so far. unpause() bakes that extension into postedAt.
    function windowEnd(Epoch storage epoch) internal view returns (uint64) {
        uint64 end = epoch.postedAt + CLAIM_DELAY;
        if (paused && end > pausedAt) end += uint64(block.timestamp) - pausedAt;
        return end;
    }

    /// @dev The root that claims verify against once promoted: the latest non-voided epoch past its window.
    function liveRoot() internal view returns (bytes32 root, uint256 total, uint256 index) {
        uint256 i = epochs.length;
        while (i > 0) {
            i -= 1;
            Epoch storage candidate = epochs[i];
            if (candidate.voided) continue;
            if (block.timestamp >= windowEnd(candidate)) return (candidate.root, candidate.total, i);
            // The pending epoch: the live one is the previous non-voided epoch.
        }
        return (bytes32(0), 0, NONE);
    }

    // ------------------------------------------------------------------
    // Poster
    // ------------------------------------------------------------------

    /// @notice Posts the root of epoch `index`, which must be the next index. Refused while a root is pending,
    /// sooner than postSpacing after the last non-voided post, when the total falls below what was already
    /// claimed, when it exceeds the highest posted total by more than epochCap, or when the balance plus what
    /// was already claimed does not cover it. Claims against it open CLAIM_DELAY later.
    function postRoot(uint256 index, bytes32 root, uint256 newTotal) external whenNotPaused {
        if (msg.sender != poster) revert NotPoster();
        if (index != epochs.length) revert EpochOutOfOrder(epochs.length);
        if (root == bytes32(0)) revert InvalidInput();
        if (hasPendingRoot()) revert RootPending();
        uint64 earliest = lastLivePostedAt + postSpacing;
        if (lastLivePostedAt != 0 && block.timestamp < earliest) revert TooSoon(earliest);
        activate();
        if (newTotal < totalClaimed) revert BelowClaimed();
        if (newTotal > highWaterTotal + epochCap) revert CapExceeded();
        if (token.balanceOf(address(this)) + totalClaimed < newTotal) revert Underfunded();
        uint64 now64 = uint64(block.timestamp);
        epochs.push(Epoch({root: root, total: newTotal, postedAt: now64, voided: false}));
        lastLivePostedAt = now64;
        if (newTotal > highWaterTotal) highWaterTotal = newTotal;
        emit RootPosted(index, root, newTotal, now64 + CLAIM_DELAY);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    /// @notice Drops the latest root inside its objection window. The epoch keeps its index; the previous
    /// live root stays claimable and the next post carries the corrected totals. Works while paused.
    function voidRoot(uint256 index) external onlyOwner {
        if (epochs.length == 0 || index != epochs.length - 1) revert EpochOutOfOrder(epochs.length);
        Epoch storage last = epochs[index];
        if (last.voided) revert AlreadyVoided();
        if (block.timestamp >= windowEnd(last)) revert WindowClosed();
        last.voided = true;
        // The spacing and high-water marks follow the latest non-voided post.
        (lastLivePostedAt, highWaterTotal) = previousLiveMarks(index);
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

    /// @notice Blocks posts, claims and rescue and freezes the objection window of a pending root.
    function pause() external onlyOwner {
        if (paused) revert InvalidInput();
        paused = true;
        pausedAt = uint64(block.timestamp);
        emit Paused(msg.sender);
    }

    /// @notice Resumes. A root whose window was open at the pause keeps the time it had left.
    function unpause() external onlyOwner {
        if (!paused) revert InvalidInput();
        uint256 extended = NONE;
        uint64 newEnd = 0;
        if (epochs.length > 0) {
            Epoch storage last = epochs[epochs.length - 1];
            uint64 end = last.postedAt + CLAIM_DELAY;
            if (!last.voided && end > pausedAt) {
                last.postedAt += uint64(block.timestamp) - pausedAt;
                extended = epochs.length - 1;
                newEnd = last.postedAt + CLAIM_DELAY;
            }
        }
        paused = false;
        lastUnpausedAt = uint64(block.timestamp);
        emit Unpaused(msg.sender, extended, newEnd);
    }

    function setPoster(address newPoster) external onlyOwner {
        if (newPoster == address(0) || newPoster == owner) revert InvalidInput();
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
    /// going live and no unpause. Refused while paused or while a root is pending, so claimants always had the
    /// full delay to claim. This ends the program: later claims fail for lack of balance.
    function rescue(address to) external onlyOwner whenNotPaused {
        if (to == address(0)) revert InvalidInput();
        if (hasPendingRoot()) revert RootPending();
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
        emit Claimed(msg.sender, activeIndex, amount, cumulative);
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// @dev Promotes the latest non-voided epoch past its window to the active root. Idempotent.
    function activate() internal {
        (bytes32 root, uint256 total, uint256 index) = liveRoot();
        if (index == NONE || index == activeIndex) return;
        activeRoot = root;
        activeTotal = total;
        activeIndex = index;
        lastLiveAt = windowEnd(epochs[index]);
        emit RootActivated(index, root, total);
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
