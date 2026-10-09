// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @notice Version 3, immutable single-project, single-asset escrow.
/// @dev The identity authority can redirect unpaid awards; it cannot change amounts. Every binding waits
/// bindingDelay before it can pay, and the owner can cancel a pending binding, so a stolen authority key
/// cannot pay itself before the sponsor can react. Fees accrue in the vault and are pulled separately, so
/// a blocked fee recipient cannot stop payouts or refunds.
/// Tokens must have exact transfers and six decimals (USDC). No upgrade or reserve rescue exists.
contract ProjectEscrow {
    struct Award {
        uint64 actorId;
        uint64 gross;
        uint64 fee;
        bytes32 sourceDigest;
        bool paid;
    }

    struct Binding {
        address destination;
        uint64 version;
        bytes32 claimDigest;
        uint64 activatesAt;
    }

    IERC20 public immutable token;
    bytes32 public immutable projectId;
    address public immutable owner;
    address public immutable refundDestination;
    address public immutable feeRecipient;
    address public immutable identityAuthority;
    uint64 public immutable bindingDelay;
    uint64 public freeBalance;
    uint64 public reservedPrincipal;
    uint64 public reservedFees;
    uint64 public totalDeposited;
    uint64 public totalPaid;
    uint64 public totalPayoutFees;
    uint64 public totalGrossWithdrawn;
    uint64 public totalWithdrawalFees;
    uint64 public accruedFees;
    mapping(bytes32 => Award) public awards;
    mapping(bytes32 => bool) public consumedSources;
    mapping(uint64 => Binding) public bindings;
    bool private entered;

    error Unauthorized();
    error InvalidInput();
    error InsufficientFreeBalance();
    error DuplicateAward();
    error InvalidBinding();
    error TransferFailed();
    error ReentrantCall();

    event Deposited(address indexed sponsor, uint256 amount);
    event AwardCommitted(bytes32 indexed id, uint64 indexed actorId, uint64 gross, uint64 fee, bytes32 sourceDigest);
    event DestinationBound(
        uint64 indexed actorId, address indexed destination, uint64 version, bytes32 claimDigest, uint64 activatesAt
    );
    event BindingCancelled(uint64 indexed actorId, uint64 version);
    event FeesClaimed(address indexed feeRecipient, uint256 amount);
    event Paid(
        bytes32 indexed id,
        uint64 indexed actorId,
        address indexed destination,
        uint64 version,
        uint64 gross,
        uint64 net,
        uint64 fee
    );
    event UnusedWithdrawn(address indexed destination, uint256 gross, uint256 net, uint256 fee);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    constructor(
        bytes32 projectId_,
        IERC20 token_,
        address owner_,
        address refundDestination_,
        address feeRecipient_,
        address identityAuthority_,
        uint64 bindingDelay_
    ) {
        // Refunds go only to the sponsor that deposited them.
        if (
            projectId_ == bytes32(0) || address(token_).code.length == 0 || token_.decimals() != 6
                || owner_ == address(0) || refundDestination_ != owner_ || feeRecipient_ == address(0)
                || identityAuthority_ == address(0) || owner_ == identityAuthority_ || feeRecipient_ == address(this)
        ) revert InvalidInput();
        projectId = projectId_;
        token = token_;
        owner = owner_;
        refundDestination = refundDestination_;
        feeRecipient = feeRecipient_;
        identityAuthority = identityAuthority_;
        bindingDelay = bindingDelay_;
    }

    /// @notice The only valid award ID for a source. Binding the chain and vault stops another vault from
    /// claiming the same ID first.
    function awardId(bytes32 sourceDigest) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), sourceDigest));
    }

    function payoutFee(uint64 gross) public pure returns (uint64) {
        return gross / 50;
    }

    /// @notice Only the declared sponsor deposits; direct donations do not grant refund rights.
    function deposit(uint64 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidInput();
        uint256 beforeBalance = token.balanceOf(address(this));
        callToken(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
        freeBalance += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @param sourceDigest Unique per award origin (project/cycle/actor/allocation), not a whole-cycle digest.
    function commitAward(bytes32 id, uint64 actorId, uint64 gross, bytes32 sourceDigest) external onlyOwner {
        if (actorId == 0 || gross == 0 || sourceDigest == bytes32(0) || id != awardId(sourceDigest)) {
            revert InvalidInput();
        }
        if (awards[id].actorId != 0 || consumedSources[sourceDigest]) revert DuplicateAward();
        uint64 fee = payoutFee(gross);
        if (gross > freeBalance) revert InsufficientFreeBalance();
        freeBalance -= gross;
        reservedPrincipal += gross - fee;
        reservedFees += fee;
        awards[id] = Award(actorId, gross, fee, sourceDigest, false);
        consumedSources[sourceDigest] = true;
        emit AwardCommitted(id, actorId, gross, fee, sourceDigest);
    }

    /// @notice Direct authority transaction; chain ID and target contract bind its signature domain.
    /// The service must verify GitHub and wallet control before signing. Expiry limits submission,
    /// not claim lifetime. expectedVersion prevents stale or reordered wallet updates.
    function bindDestination(
        uint64 actorId,
        address destination,
        uint64 expectedVersion,
        bytes32 claimDigest,
        uint64 expiresAt
    ) external {
        if (msg.sender != identityAuthority) revert Unauthorized();
        if (
            actorId == 0 || destination == address(0) || destination == address(this) || claimDigest == bytes32(0)
                || expiresAt < block.timestamp || bindings[actorId].version != expectedVersion
        ) revert InvalidBinding();
        uint64 version = expectedVersion + 1;
        uint64 activatesAt = uint64(block.timestamp) + bindingDelay;
        bindings[actorId] = Binding(destination, version, claimDigest, activatesAt);
        emit DestinationBound(actorId, destination, version, claimDigest, activatesAt);
    }

    /// @notice The sponsor can stop a pending binding before it pays. Only a new authority binding can follow.
    function cancelBinding(uint64 actorId, uint64 expectedVersion) external onlyOwner {
        Binding storage binding = bindings[actorId];
        if (binding.version == 0 || binding.version != expectedVersion || block.timestamp >= binding.activatesAt) {
            revert InvalidBinding();
        }
        binding.activatesAt = type(uint64).max;
        emit BindingCancelled(actorId, expectedVersion);
    }

    function pay(bytes32 id, uint64 expectedBindingVersion) external nonReentrant {
        Award storage award = awards[id];
        Binding memory binding = bindings[award.actorId];
        if (award.actorId == 0 || award.paid) revert InvalidInput();
        if (binding.version == 0 || binding.version != expectedBindingVersion || block.timestamp < binding.activatesAt) revert InvalidBinding();
        uint64 net = award.gross - award.fee;
        award.paid = true;
        reservedPrincipal -= net;
        reservedFees -= award.fee;
        totalPaid += net;
        totalPayoutFees += award.fee;
        accruedFees += award.fee;
        sendExact(binding.destination, net);
        emit Paid(id, award.actorId, binding.destination, binding.version, award.gross, net, award.fee);
    }

    /// @notice 10% of cumulative gross withdrawals, rounded down. Splitting cannot reduce fees.
    function withdrawUnused(uint64 gross) external onlyOwner nonReentrant {
        if (gross == 0) revert InvalidInput();
        if (gross > freeBalance) revert InsufficientFreeBalance();
        uint64 cumulative = totalGrossWithdrawn + gross;
        uint64 nextFee = cumulative / 10;
        uint64 fee = nextFee - totalWithdrawalFees;
        freeBalance -= gross;
        totalGrossWithdrawn = cumulative;
        totalWithdrawalFees = nextFee;
        accruedFees += fee;
        sendExact(refundDestination, gross - fee);
        emit UnusedWithdrawn(refundDestination, gross, gross - fee, fee);
    }

    /// @notice Anyone can move accrued fees to the fee recipient. Only this call depends on that address.
    function claimFees() external nonReentrant {
        uint64 amount = accruedFees;
        if (amount == 0) revert InvalidInput();
        accruedFees = 0;
        sendExact(feeRecipient, amount);
        emit FeesClaimed(feeRecipient, amount);
    }

    function sendExact(address destination, uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeVault = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(destination);
        callToken(abi.encodeCall(IERC20.transfer, (destination, amount)));
        if (
            token.balanceOf(address(this)) != beforeVault - amount
                || token.balanceOf(destination) != beforeRecipient + amount
        ) revert TransferFailed();
    }

    function callToken(bytes memory data) private {
        (bool ok, bytes memory result) = address(token).call(data);
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) {
            revert TransferFailed();
        }
    }
}

/// @notice One vault per immutable project ID in this version of the deployment registry.
/// The registrar is a disclosed project-registration trust boundary, not a money authority.
contract EscrowFactory {
    address public immutable registrar;
    IERC20 public immutable token;
    address public immutable feeRecipient;
    address public immutable identityAuthority;
    uint64 public immutable bindingDelay;
    mapping(bytes32 => address) public vaults;
    event VaultCreated(
        bytes32 indexed projectId, address indexed vault, address indexed owner, address refundDestination
    );

    constructor(IERC20 token_, address feeRecipient_, address identityAuthority_, uint64 bindingDelay_) {
        if (
            address(token_).code.length == 0 || token_.decimals() != 6 || feeRecipient_ == address(0)
                || identityAuthority_ == address(0)
        ) revert ProjectEscrow.InvalidInput();
        registrar = msg.sender;
        token = token_;
        feeRecipient = feeRecipient_;
        identityAuthority = identityAuthority_;
        bindingDelay = bindingDelay_;
    }

    function create(bytes32 projectId, address owner, address refundDestination) external returns (address vault) {
        if (msg.sender != registrar) revert ProjectEscrow.Unauthorized();
        if (vaults[projectId] != address(0)) revert ProjectEscrow.DuplicateAward();
        vault = address(
            new ProjectEscrow{salt: projectId}(
                projectId, token, owner, refundDestination, feeRecipient, identityAuthority, bindingDelay
            )
        );
        vaults[projectId] = vault;
        emit VaultCreated(projectId, vault, owner, refundDestination);
    }
}
