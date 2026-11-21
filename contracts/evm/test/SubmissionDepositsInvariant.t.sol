// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionDeposits} from "../src/SubmissionDeposits.sol";
import {TestDollar} from "../integration/TestDollar.sol";
import {WideToken} from "./WideToken.sol";

interface DepositsInvariantVm {
    function prank(address) external;
    function warp(uint256) external;
}

interface HandlerToken {
    function balanceOf(address) external view returns (uint256);
    function mint(address, uint256) external;
    function approve(address, uint256) external returns (bool);
}

/// @dev Random payer, resolver, owner and passer-by sequences against one contract and two tokens. Calls the
/// contract refuses are allowed. The handler keeps its own copy of every record and of where every token
/// should be, and sets `fault` when a call succeeds that the rules forbid.
contract DepositsHandler {
    DepositsInvariantVm internal constant vm =
        DepositsInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant FEE_WALLET = 0x8f77C37D8650776bFe73c9b12B15209eE15D9b86;
    address internal constant BURN = 0x000000000000000000000000000000000000dEaD;

    SubmissionDeposits public box;
    address[2] public tokens;
    address[4] public payers;
    address[2] public owners;
    address[2] public resolvers;

    struct Ghost {
        bytes32 recordHash;
        address payer;
        address token;
        address keptTo;
        uint128 amount;
        uint64 depositedAt;
        SubmissionDeposits.State state;
    }

    Ghost[] internal ghosts; // ghosts[id - 1]
    /// @dev Sum of the amounts of the open deposits of each token.
    mapping(address => uint256) public ghostOpen;
    /// @dev Where every unit of each token should be outside the contract.
    mapping(address => mapping(address => uint256)) public expected;
    /// @dev First rule a successful call broke, or empty.
    string public fault;

    uint256 public refunds;
    uint256 public keeps;
    uint256 public reclaims;
    uint256 public batches;
    uint256 public pausedRefusals;
    uint256 public rotations;
    uint256 public handovers;

    constructor(SubmissionDeposits box_, address[2] memory tokens_, address owner_, address resolver_) {
        box = box_;
        tokens = tokens_;
        payers = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
        owners = [owner_, address(0xA11CF)];
        resolvers = [resolver_, address(0x5E502)];
    }

    function count() external view returns (uint256) {
        return ghosts.length;
    }

    function ghost(uint256 id) external view returns (Ghost memory) {
        return ghosts[id - 1];
    }

    function tracked() public view returns (address[6] memory who) {
        who = [payers[0], payers[1], payers[2], payers[3], FEE_WALLET, BURN];
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    function deposit(uint256 payerSeed, uint256 tokenSeed, uint256 amount, uint256 keptSeed, bytes32 item) external {
        address payer = payers[payerSeed % 4];
        address token = tokens[tokenSeed % 2];
        // Mostly fee-sized amounts; one call in eight uses the full width.
        amount = amount % 8 == 0 ? 1 + amount % type(uint96).max : 1 + amount % 10_000_000;
        // The fee wallet, the burn address, or (rarely) another payer.
        address keptTo = keptSeed % 5 == 0 ? payers[(keptSeed / 5) % 4] : keptSeed % 2 == 0 ? FEE_WALLET : BURN;
        HandlerToken(token).mint(payer, amount);
        expected[token][payer] += amount;
        vm.prank(payer);
        HandlerToken(token).approve(address(box), amount);
        bool paused = box.depositsPaused();
        vm.prank(payer);
        try box.deposit(item, token, uint128(amount), keptTo) returns (uint256 id) {
            if (paused) fault = "deposit accepted while paused";
            if (id != ghosts.length + 1) fault = "ids do not count up by one";
            SubmissionDeposits.Deposit memory record = box.deposits(id);
            if (
                record.payer != payer || record.token != token || record.amount != amount || record.keptTo != keptTo
                    || record.item != item || record.depositedAt != block.timestamp
                    || record.state != SubmissionDeposits.State.Open
            ) fault = "deposit recorded wrongly";
            ghosts.push(
                Ghost(
                    hashOf(record),
                    payer,
                    token,
                    keptTo,
                    uint128(amount),
                    uint64(block.timestamp),
                    SubmissionDeposits.State.Open
                )
            );
            ghostOpen[token] += amount;
            expected[token][payer] -= amount;
        } catch {
            if (!paused) fault = "valid deposit refused";
            ++pausedRefusals;
        }
    }

    /// @dev Any caller tries to settle; only the current resolver may succeed.
    function resolve(uint256 callerSeed, uint256 idSeed, bool refund) external {
        if (ghosts.length == 0) return;
        uint256 id = 1 + idSeed % ghosts.length;
        address caller = anyone(callerSeed);
        bool wasOpen = ghosts[id - 1].state == SubmissionDeposits.State.Open;
        vm.prank(caller);
        try box.resolve(id, refund) {
            if (caller != box.resolver()) fault = "someone other than the resolver settled";
            if (!wasOpen) fault = "a closed deposit settled again";
            settled(id, refund);
        } catch {
            if (caller == box.resolver() && wasOpen) fault = "the resolver was refused an open deposit";
        }
    }

    /// @dev The resolver settles up to four distinct open deposits at once.
    function resolveMany(uint256 seed, uint8 width, uint8 refundBits) external {
        uint256 n = ghosts.length;
        if (n == 0) return;
        uint256[] memory picked = new uint256[](1 + width % 4);
        uint256 found;
        for (uint256 i = 0; i < n && found < picked.length; i++) {
            uint256 id = 1 + (seed % n + i) % n;
            if (ghosts[id - 1].state == SubmissionDeposits.State.Open) picked[found++] = id;
        }
        if (found == 0) return;
        uint256[] memory ids = new uint256[](found);
        bool[] memory outcomes = new bool[](found);
        for (uint256 i = 0; i < found; i++) {
            ids[i] = picked[i];
            outcomes[i] = (refundBits >> i) & 1 == 1;
        }
        vm.prank(box.resolver());
        box.resolveMany(ids, outcomes);
        for (uint256 i = 0; i < found; i++) {
            settled(ids[i], outcomes[i]);
        }
        ++batches;
    }

    /// @dev Any caller tries to reclaim; only the payer, only after the delay, only while open.
    function reclaim(uint256 callerSeed, uint256 idSeed) external {
        if (ghosts.length == 0) return;
        uint256 id = 1 + idSeed % ghosts.length;
        Ghost storage g = ghosts[id - 1];
        // Half the calls come from the payer, so the successful path is reached.
        address caller = callerSeed % 2 == 0 ? g.payer : anyone(callerSeed / 2);
        bool allowed = caller == g.payer && g.state == SubmissionDeposits.State.Open
            && block.timestamp >= uint256(g.depositedAt) + box.reclaimDelay();
        vm.prank(caller);
        try box.reclaim(id) {
            if (!allowed) fault = "a reclaim succeeded against the rules";
            g.state = SubmissionDeposits.State.Reclaimed;
            ghostOpen[g.token] -= g.amount;
            expected[g.token][g.payer] += g.amount;
            ++reclaims;
        } catch {
            if (allowed) fault = "the payer was refused a reclaim that was due";
        }
    }

    function pause(uint256 callerSeed, bool paused) external {
        address caller = anyone(callerSeed);
        vm.prank(caller);
        try box.pauseDeposits(paused) {
            if (caller != box.owner()) fault = "someone other than the owner paused";
        } catch {}
    }

    function rotateResolver(uint256 callerSeed, uint256 nextSeed) external {
        address caller = callerSeed % 2 == 0 ? box.owner() : anyone(callerSeed / 2);
        address next = anyone(nextSeed);
        address owner = box.owner();
        address pending = box.pendingOwner();
        vm.prank(caller);
        try box.setResolver(next) {
            if (caller != owner) fault = "someone other than the owner replaced the resolver";
            if (next == owner || next == pending) fault = "an owner became the resolver";
            ++rotations;
        } catch {}
    }

    function handOver(uint256 callerSeed, uint256 nextSeed, bool accept) external {
        address caller = callerSeed % 2 == 0 ? box.owner() : anyone(callerSeed / 2);
        address next = anyone(nextSeed);
        address resolver = box.resolver();
        vm.prank(caller);
        try box.transferOwnership(next) {
            if (next == resolver) fault = "the resolver was named the next owner";
        } catch {}
        if (!accept) return;
        address pending = box.pendingOwner();
        vm.prank(next);
        try box.acceptOwnership() {
            if (next != pending) fault = "ownership accepted by someone not named";
            ++handovers;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + dt % 20 days);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function settled(uint256 id, bool refund) internal {
        Ghost storage g = ghosts[id - 1];
        g.state = refund ? SubmissionDeposits.State.Refunded : SubmissionDeposits.State.Kept;
        ghostOpen[g.token] -= g.amount;
        expected[g.token][refund ? g.payer : g.keptTo] += g.amount;
        if (refund) ++refunds;
        else ++keeps;
    }

    /// @dev Owners, resolvers, payers and a stranger.
    function anyone(uint256 seed) internal view returns (address) {
        uint256 pick = seed % 9;
        if (pick < 2) return owners[pick];
        if (pick < 4) return resolvers[pick - 2];
        if (pick < 8) return payers[pick - 4];
        return address(0xBAD);
    }

    /// @dev Everything about a record that must never change after the deposit.
    function hashOf(SubmissionDeposits.Deposit memory record) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(record.payer, record.token, record.amount, record.keptTo, record.item, record.depositedAt)
        );
    }

    function fixedPartOf(uint256 id) external view returns (bytes32) {
        return hashOf(box.deposits(id));
    }
}

contract SubmissionDepositsInvariantTest {
    DepositsInvariantVm internal constant vm =
        DepositsInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant OWNER = address(0xA11CE);
    address internal constant RESOLVER = address(0x5E501);

    SubmissionDeposits internal box;
    DepositsHandler internal handler;
    address[2] internal tokens;

    function setUp() public {
        vm.warp(1_794_960_000); // 18 November 2026 UTC
        box = new SubmissionDeposits(OWNER, RESOLVER, 30 days);
        tokens = [address(new TestDollar()), address(new WideToken(18))];
        handler = new DepositsHandler(box, tokens, OWNER, RESOLVER);
    }

    function targetContracts() public view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    /// @dev A fixed sequence through the handler reaches every outcome the campaign relies on.
    function test_handlerReachesEveryOutcome() public {
        handler.deposit(0, 0, 1, 0, bytes32("a")); // 1: payer 0, dollars, fee wallet
        handler.deposit(1, 1, 8, 1, bytes32("b")); // 2: payer 1, wide token, full-width amount, burn
        handler.deposit(2, 0, 3, 5, bytes32("c")); // 3: payer 2, dollars, kept to another payer
        handler.deposit(3, 1, 5, 2, bytes32("d")); // 4
        handler.deposit(0, 0, 7, 3, bytes32("e")); // 5
        require(handler.count() == 5, "five deposits");
        handler.resolve(2, 0, true); // the resolver refunds 1
        handler.resolve(0, 1, false); // the owner tries 2 and is refused
        handler.resolve(2, 1, false); // the resolver keeps 2
        require(handler.refunds() == 1 && handler.keeps() == 1, "one of each");
        handler.resolveMany(2, 0, 0); // keeps 3
        require(handler.batches() == 1 && handler.keeps() == 2, "batch");
        handler.reclaim(0, 3); // payer of 4, too early
        handler.warp(19 days);
        handler.warp(19 days);
        handler.reclaim(0, 3); // payer of 4, due
        require(handler.reclaims() == 1, "reclaimed");
        handler.pause(0, true);
        handler.deposit(0, 0, 1, 0, bytes32("f"));
        require(handler.pausedRefusals() == 1 && handler.count() == 5, "paused deposit refused");
        handler.rotateResolver(0, 3); // owner names the second resolver
        handler.handOver(0, 1, true); // owner hands over to the second owner
        require(handler.rotations() == 1 && handler.handovers() == 1, "roles moved");
        handler.resolve(3, 4, true); // the new resolver refunds 5 while deposits are paused
        require(handler.refunds() == 2, "settled while paused by the new resolver");
        invariant_balanceEqualsOpenDeposits();
        invariant_rulesHold();
        afterInvariant();
    }

    /// @dev The contract holds exactly the open deposits of each token, no more and no less.
    function invariant_balanceEqualsOpenDeposits() public view {
        for (uint256 t = 0; t < 2; t++) {
            uint256 held = HandlerToken(tokens[t]).balanceOf(address(box));
            require(held == box.openTotal(tokens[t]), "balance equals openTotal");
            require(held == handler.ghostOpen(tokens[t]), "balance equals the sum of open deposits");
        }
    }

    /// @dev No forbidden call succeeded, every token outside the contract is with a payer or a kept address
    /// in exactly the amount the outcomes imply, and the resolver holds no owner role.
    function invariant_rulesHold() public view {
        require(bytes(handler.fault()).length == 0, handler.fault());
        require(box.resolver() != box.owner() && box.resolver() != box.pendingOwner(), "resolver is an owner");
        require(box.depositCount() == handler.count(), "deposit count");
        address[6] memory who = handler.tracked();
        for (uint256 t = 0; t < 2; t++) {
            for (uint256 i = 0; i < who.length; i++) {
                require(
                    HandlerToken(tokens[t]).balanceOf(who[i]) == handler.expected(tokens[t], who[i]),
                    "a token is somewhere the outcomes do not explain"
                );
            }
        }
    }

    /// @dev At the end of each run, every record still matches what was deposited and its last outcome, and
    /// the open ones add up to what the contract holds.
    function afterInvariant() public view {
        uint256[2] memory open;
        uint256 n = handler.count();
        for (uint256 id = 1; id <= n; id++) {
            DepositsHandler.Ghost memory g = handler.ghost(id);
            require(handler.fixedPartOf(id) == g.recordHash, "a record changed after its deposit");
            require(box.deposits(id).state == g.state, "a state differs from the last outcome");
            if (g.state == SubmissionDeposits.State.Open) open[g.token == tokens[0] ? 0 : 1] += g.amount;
        }
        for (uint256 t = 0; t < 2; t++) {
            require(HandlerToken(tokens[t]).balanceOf(address(box)) == open[t], "open records equal the balance");
        }
        require(box.deposits(n + 1).state == SubmissionDeposits.State.None, "no record beyond the count");
    }
}
