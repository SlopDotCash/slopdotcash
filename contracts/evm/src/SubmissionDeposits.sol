// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IDepositToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Holds refundable submission deposits, one per payment for a named item (a pull request). Each
/// deposit fixes, when it is made, the only two places its tokens can ever go: back to the payer, or to the
/// `keptTo` address the payer named. The resolver chooses between those two and nothing else. If nobody
/// resolves a deposit for `reclaimDelay`, the payer takes it back without anyone's help.
/// @dev Not upgradeable and no proxy. The contract keeps no list of accepted tokens, amounts or kept
/// addresses: that check is off chain, and a deposit that fails it is refunded by the resolver or reclaimed
/// by its payer. The owner replaces the resolver and pauses new deposits; no owner or resolver action can
/// send a deposit anywhere but its payer or its `keptTo`, and pausing never blocks `resolve` or `reclaim`.
/// The resolver is never the owner or the pending owner. Token transfers must be exact on both sides, so
/// fee-on-transfer and rebasing tokens are refused. Tokens sent to this contract without `deposit` belong to
/// no deposit and cannot be moved by anyone. All timing uses block.timestamp, never block.number.
contract SubmissionDeposits {
    enum State {
        None,
        Open,
        Refunded,
        Kept,
        Reclaimed
    }

    struct Deposit {
        address payer;
        address token;
        uint128 amount;
        address keptTo;
        bytes32 item;
        uint64 depositedAt;
        State state;
    }

    /// @notice Longest reclaim delay a deployment may fix, so a payer is never stranded for longer.
    uint64 public constant MAX_RECLAIM_DELAY = 365 days;

    /// @notice How long after its deposit a payer must wait before reclaiming an unresolved deposit.
    uint64 public immutable reclaimDelay;

    address public owner;
    address public pendingOwner;
    /// @dev Shares one storage slot with the two flags below.
    address public resolver;
    bool public depositsPaused;
    bool private entered;

    /// @notice Number of deposits ever made. Ids count up from 1, so this is also the latest id.
    uint256 public depositCount;
    /// @notice Sum of the open deposits of each token, in token base units.
    mapping(address => uint256) public openTotal;
    mapping(uint256 => Deposit) private records;

    event Deposited(
        uint256 indexed id, bytes32 indexed item, address indexed payer, address token, uint128 amount, address keptTo
    );
    event Resolved(uint256 indexed id, bool refunded);
    event Reclaimed(uint256 indexed id);
    event ResolverChanged(address indexed previousResolver, address indexed newResolver);
    event DepositsPaused(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotResolver();
    error NotPayer();
    error NotOpen(uint256 id);
    error DepositsArePaused();
    error InvalidInput();
    error ReclaimTooEarly(uint64 earliest);
    /// @dev The pull of a deposit failed or did not deliver exactly the amount.
    error TransferFailed();
    /// @dev The payout of deposit `id` failed or did not move exactly its amount.
    error PayoutFailed(uint256 id);
    error ReentrantCall();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    constructor(address owner_, address resolver_, uint64 reclaimDelay_) {
        if (
            owner_ == address(0) || resolver_ == address(0) || owner_ == resolver_ || reclaimDelay_ == 0
                || reclaimDelay_ > MAX_RECLAIM_DELAY
        ) {
            revert InvalidInput();
        }
        owner = owner_;
        resolver = resolver_;
        reclaimDelay = reclaimDelay_;
        emit OwnershipTransferred(address(0), owner_);
        emit ResolverChanged(address(0), resolver_);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice The record of deposit `id`. An id never used reads as all zero with state None.
    function deposits(uint256 id) external view returns (Deposit memory) {
        return records[id];
    }

    /// @notice When the payer of open deposit `id` may reclaim it, or zero when the deposit is not open.
    function reclaimableAt(uint256 id) external view returns (uint64) {
        Deposit storage record = records[id];
        return record.state == State.Open ? record.depositedAt + reclaimDelay : 0;
    }

    // ------------------------------------------------------------------
    // Payers
    // ------------------------------------------------------------------

    /// @notice Pulls exactly `amount` of `token` from msg.sender and records it against `item`. The payer and
    /// `keptTo` are fixed here and never change. Refused while deposits are paused, for a zero amount, for a
    /// zero `keptTo` or this contract as `keptTo`, for a token address without code, and when the balance does
    /// not rise by exactly `amount`.
    function deposit(bytes32 item, address token, uint128 amount, address keptTo)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (depositsPaused) revert DepositsArePaused();
        if (amount == 0 || keptTo == address(0) || keptTo == address(this) || token.code.length == 0) {
            revert InvalidInput();
        }
        uint256 beforeBalance = IDepositToken(token).balanceOf(address(this));
        if (
            !callToken(token, abi.encodeCall(IDepositToken.transferFrom, (msg.sender, address(this), amount)))
                || IDepositToken(token).balanceOf(address(this)) != beforeBalance + amount
        ) revert TransferFailed();
        id = ++depositCount;
        records[id] = Deposit({
            payer: msg.sender,
            token: token,
            amount: amount,
            keptTo: keptTo,
            item: item,
            depositedAt: uint64(block.timestamp),
            state: State.Open
        });
        openTotal[token] += amount;
        emit Deposited(id, item, msg.sender, token, amount, keptTo);
    }

    /// @notice Returns open deposit `id` to its payer once `reclaimDelay` has passed since the deposit. Only
    /// the payer may call it. It works while deposits are paused and whoever the resolver is.
    function reclaim(uint256 id) external nonReentrant {
        Deposit storage record = records[id];
        if (record.state != State.Open) revert NotOpen(id);
        if (msg.sender != record.payer) revert NotPayer();
        uint64 earliest = record.depositedAt + reclaimDelay;
        if (block.timestamp < earliest) revert ReclaimTooEarly(earliest);
        record.state = State.Reclaimed;
        openTotal[record.token] -= record.amount;
        emit Reclaimed(id);
        sendExact(id, record.token, record.payer, record.amount);
    }

    // ------------------------------------------------------------------
    // Resolver
    // ------------------------------------------------------------------

    /// @notice Settles open deposit `id` once: `refund` sends its amount to the payer, otherwise to its
    /// `keptTo`. Works while deposits are paused.
    function resolve(uint256 id, bool refund) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        settle(id, refund);
    }

    /// @notice Settles several deposits in one transaction, all or nothing: one deposit that is not open, or
    /// one payout that fails, reverts the whole call, and the error names that deposit.
    function resolveMany(uint256[] calldata ids, bool[] calldata refunds) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (ids.length == 0 || ids.length != refunds.length) revert InvalidInput();
        for (uint256 i = 0; i < ids.length; i++) {
            settle(ids[i], refunds[i]);
        }
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    /// @notice Replaces the resolver. The owner and the pending owner may not become the resolver, so one key
    /// never holds both roles.
    function setResolver(address next) external onlyOwner {
        if (next == address(0) || next == owner || next == pendingOwner || next == resolver) revert InvalidInput();
        emit ResolverChanged(resolver, next);
        resolver = next;
    }

    /// @notice Stops or resumes new deposits. It never blocks `resolve`, `resolveMany` or `reclaim`.
    function pauseDeposits(bool paused) external onlyOwner {
        if (paused == depositsPaused) revert InvalidInput();
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == resolver) revert InvalidInput();
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

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev The state changes before the transfer, and every entry point holds the reentrancy lock.
    function settle(uint256 id, bool refund) private {
        Deposit storage record = records[id];
        if (record.state != State.Open) revert NotOpen(id);
        record.state = refund ? State.Refunded : State.Kept;
        openTotal[record.token] -= record.amount;
        emit Resolved(id, refund);
        sendExact(id, record.token, refund ? record.payer : record.keptTo, record.amount);
    }

    /// @dev Sends `amount` and requires both balances to move by exactly that much. A failure names the deposit,
    /// so a failed batch shows which deposit could not be paid.
    function sendExact(uint256 id, address token, address destination, uint256 amount) private {
        uint256 beforeHere = IDepositToken(token).balanceOf(address(this));
        uint256 beforeThere = IDepositToken(token).balanceOf(destination);
        if (
            !callToken(token, abi.encodeCall(IDepositToken.transfer, (destination, amount)))
                || IDepositToken(token).balanceOf(address(this)) != beforeHere - amount
                || IDepositToken(token).balanceOf(destination) != beforeThere + amount
        ) revert PayoutFailed(id);
    }

    /// @dev True when the token call succeeded and returned nothing or exactly one true word.
    function callToken(address token, bytes memory data) private returns (bool) {
        (bool ok, bytes memory result) = token.call(data);
        return ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool))));
    }
}
