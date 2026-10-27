// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {DeployFactory} from "./DeployFactory.sol";

import {EscrowFactory, IERC20, ProjectEscrow, Purpose} from "../src/ProjectEscrow.sol";
import {TestDollar} from "../integration/TestDollar.sol";

interface MonthlyVm {
    function prank(address) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
    function store(address, bytes32, bytes32) external;
}

/// @dev Owner decision D13: permissionless vault creation by owner and purpose, and the bounded monthly
/// commitment finalized by its owner with the identity authority's signature.
contract MonthlyCommitmentTest {
    MonthlyVm internal constant vm = MonthlyVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant AUTHORITY_KEY = 0xA07;
    uint256 internal constant NEXT_AUTHORITY_KEY = 0xA08;
    uint256 internal constant STRANGER_KEY = 0xBAD;
    uint256 internal constant WALLET_KEY = 0xC0DE;
    address internal constant OWNER = address(0xA11CE);
    address internal constant SUBMITTER = address(0x5B);
    address internal constant FEE = address(0xFEE);
    address internal constant REGISTRAR = address(0x5E6);
    uint64 internal constant DELAY = 48 hours;
    bytes32 internal constant PROJECT = keccak256("project");
    uint32 internal constant PERIOD = 202611;
    /// @dev Calendar ends of November and December 2026.
    uint64 internal constant NOVEMBER_OPENS = 1_796_083_200;
    uint64 internal constant DECEMBER_OPENS = 1_798_761_600;

    event VaultCreated(
        bytes32 indexed projectId,
        address indexed token,
        address indexed vault,
        address owner,
        Purpose purpose,
        uint8 decimals
    );
    event MonthlyCommitted(uint32 indexed period, bytes32 allocationRoot, uint128 gross, uint256 awards);

    address internal authority;
    TestDollar internal usdc;
    EscrowFactory internal factory;
    ProjectEscrow internal vault;
    ProjectEscrow internal bountyVault;

    function setUp() public {
        vm.warp(NOVEMBER_OPENS - 30 days);
        authority = vm.addr(AUTHORITY_KEY);
        usdc = new TestDollar();
        factory = DeployFactory.create(REGISTRAR, FEE, authority, DELAY);
        vm.prank(OWNER);
        vault = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        vm.prank(OWNER);
        bountyVault = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Bounty));
        usdc.mint(OWNER, 1_000_000e6);
        vm.prank(OWNER);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(OWNER);
        usdc.approve(address(bountyVault), type(uint256).max);
        vm.prank(OWNER);
        vault.deposit(10_000e6);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(1_000e6, true);
    }

    function allocation(uint128 first, uint128 second, uint128 third)
        internal
        pure
        returns (ProjectEscrow.MonthlyAward[] memory entries)
    {
        entries = new ProjectEscrow.MonthlyAward[](3);
        entries[0] = ProjectEscrow.MonthlyAward(11, first, keccak256("2026-11/11"));
        entries[1] = ProjectEscrow.MonthlyAward(12, second, keccak256("2026-11/12"));
        entries[2] = ProjectEscrow.MonthlyAward(13, third, keccak256("2026-11/13"));
    }

    function attest(uint256 key, ProjectEscrow target, uint32 period, ProjectEscrow.MonthlyAward[] memory entries)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.monthlyDigest(period, target.allocationRoot(entries)));
        return abi.encodePacked(r, s, v);
    }

    function submit(uint32 period, ProjectEscrow.MonthlyAward[] memory entries, bytes memory signature) internal {
        vm.prank(OWNER);
        vault.commitMonthly(period, entries, signature);
    }

    function test_ownerFinalizesOldMonthOnceWhileAttesterCannotCommitIt() public {
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.warp(DECEMBER_OPENS + 60 days);
        vm.prank(SUBMITTER);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == bytes32(0), "unauthorized root persisted");
        vm.prank(OWNER);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == vault.allocationRoot(entries), "owner root missing");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyAlreadyCommitted.selector);
        vault.commitMonthly(PERIOD, entries, signature);
    }

    function test_ownerCanFinalizeAsSoonAsTheCalendarMonthIsClosed() public {
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.warp(NOVEMBER_OPENS);
        vm.prank(OWNER);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == vault.allocationRoot(entries), "closed month refused");
    }

    // ------------------------------------------------------------------
    // Permissionless creation and purpose isolation
    // ------------------------------------------------------------------

    function test_createIsPermissionlessAndTheCallerIsTheOwner() public {
        address anyone = address(0xA1);
        bytes32 key = factory.vaultKey(anyone, PROJECT, IERC20(address(usdc)), Purpose.Ordinary);
        vm.expectEmit(true, true, false, true, address(factory));
        emit VaultCreated(PROJECT, address(usdc), address(0), anyone, Purpose.Ordinary, 6);
        vm.prank(anyone);
        ProjectEscrow created = ProjectEscrow(factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary));
        require(created.owner() == anyone && created.purpose() == Purpose.Ordinary, "caller is owner");
        require(factory.vaults(key) == address(created), "indexed under the caller's key");
        require(address(created) != address(vault), "another owner never reaches this owner's vault");
        // The owner cannot create a second vault under the same key.
        vm.prank(anyone);
        vm.expectRevert(EscrowFactory.DuplicateVault.selector);
        factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary);
        // The identity authority can never own a vault.
        vm.prank(authority);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        factory.create(PROJECT, IERC20(address(usdc)), Purpose.Ordinary);
    }

    function test_ordinaryAndBountyVaultsAreSeparate() public {
        require(address(vault) != address(bountyVault), "two vaults");
        require(vault.purpose() == Purpose.Ordinary && bountyVault.purpose() == Purpose.Bounty, "purposes");
        require(
            factory.vaults(factory.vaultKey(OWNER, PROJECT, IERC20(address(usdc)), Purpose.Bounty))
                == address(bountyVault),
            "bounty key"
        );
        vm.prank(OWNER);
        bountyVault.deposit(400e6);
        require(vault.freeBalance() == 10_000e6 && bountyVault.freeBalance() == 400e6, "balances never mix");

        bytes32 source = keccak256("bounty-commitment");
        bytes32 bountyId = bountyVault.awardId(source);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        bountyVault.commitAward(bountyId, 7, 100e6, source);
        vm.prank(OWNER);
        bountyVault.commitBountyAward(bountyId, 7, 100e6, source);
        (, uint128 gross, uint128 fee,,,) = bountyVault.awards(bountyId);
        require(gross == 100e6 && fee == 25e6, "bounty split");

        bytes32 ordinaryId = vault.awardId(source);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        vault.commitBountyAward(ordinaryId, 7, 100e6, source);

        // A bounty vault never takes a monthly allocation.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        bountyVault.setMonthlyCommitment(1e6, true);
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(1e6, 1e6, 1e6);
        bytes memory signature = attest(AUTHORITY_KEY, bountyVault, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.WrongPurpose.selector);
        bountyVault.commitMonthly(PERIOD, entries, signature);
    }

    // ------------------------------------------------------------------
    // Monthly window
    // ------------------------------------------------------------------

    function test_closedMonthsHaveNoFinalizationExpiry() public view {
        (uint64 opensAt, uint64 closesAt) = vault.monthlyWindow(PERIOD);
        require(opensAt == NOVEMBER_OPENS && closesAt == type(uint64).max, "November 2026");
        (opensAt, closesAt) = vault.monthlyWindow(202612);
        require(opensAt == DECEMBER_OPENS && closesAt == type(uint64).max, "December 2026");
        (opensAt,) = vault.monthlyWindow(202802);
        require(opensAt == 1_835_481_600, "leap February");
    }

    function test_invalidPeriodsAreRejected() public {
        uint32[4] memory invalid = [uint32(202600), 202613, 199912, 1000001];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(ProjectEscrow.InvalidInput.selector);
            vault.monthlyWindow(invalid[i]);
        }
    }

    function test_ownerCannotFinalizeBeforeTheMonthEnds() public {
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.warp(NOVEMBER_OPENS - 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyWindowClosed.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        vm.warp(NOVEMBER_OPENS);
        submit(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == vault.allocationRoot(entries), "closed month accepted");
    }

    // ------------------------------------------------------------------
    // Owner finalization; every award follows the ordinary rules
    // ------------------------------------------------------------------

    function test_ownerCommitsASignedAllocationAndPayStaysPermissionless() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes32 root = vault.allocationRoot(entries);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MonthlyCommitted(PERIOD, root, 600e6, 3);
        submit(PERIOD, entries, attest(AUTHORITY_KEY, vault, PERIOD, entries));
        require(vault.monthlyRoots(PERIOD) == root, "root recorded");
        require(vault.freeBalance() == 9_400e6, "free balance reserved");
        require(vault.reservedPrincipal() == 588e6 && vault.reservedFees() == 12e6, "ordinary 2% fee");
        for (uint256 i; i < entries.length; ++i) {
            (uint64 actor, uint128 gross, uint128 fee, bytes32 source,, bool paid) =
                vault.awards(vault.awardId(entries[i].sourceDigest));
            require(
                actor == entries[i].actorId && gross == entries[i].gross && fee == (gross + 49) / 50
                    && source == entries[i].sourceDigest && !paid,
                "award committed"
            );
            require(vault.consumedSources(entries[i].sourceDigest), "source consumed");
        }
        // The award pays through the ordinary binding and delay rules, from any caller.
        address wallet = vm.addr(WALLET_KEY);
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        bytes32 claim = keccak256("claim");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WALLET_KEY, vault.bindingDigest(11, wallet, 0, claim, expiresAt));
        vm.prank(authority);
        vault.bindDestination(11, wallet, 0, claim, expiresAt, abi.encodePacked(r, s, v));
        bytes32 id = vault.awardId(entries[0].sourceDigest);
        vm.prank(address(0xCA11));
        vm.expectRevert(ProjectEscrow.AwardPending.selector);
        vault.pay(id, 1);
        vm.warp(block.timestamp + DELAY);
        vm.prank(address(0xCA11));
        vault.pay(id, 1);
        require(usdc.balanceOf(wallet) == 98e6, "net paid to the bound wallet");
    }

    function test_monthlyAndManualCommitsCannotReserveTheSameSourceTwice() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes32 source = entries[1].sourceDigest;
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 12, 200e6, source);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        submit(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == vault.allocationRoot(entries), "month completes");
        require(vault.freeBalance() == 9_400e6, "each source reserved once");
        require(vault.reservedPrincipal() + vault.reservedFees() == 600e6, "exact total reserved");
    }

    /// @dev Rewrite a reserved award as a vault before the rounded-up fee recorded it: fee floor(gross / 50),
    /// with the vault's reserved totals moved to match. Slots follow `forge inspect ProjectEscrow storage-layout`.
    function reserveWithFloorFee(bytes32 id) internal {
        (, uint128 gross, uint128 fee,,,) = vault.awards(id);
        uint128 floorFee = gross / 50;
        require(fee == floorFee + 1, "the new fee is one unit above the floor fee");
        bytes32 awardSlot = keccak256(abi.encode(id, uint256(11)));
        vm.store(address(vault), bytes32(uint256(awardSlot) + 1), bytes32(uint256(floorFee)));
        uint256 principal = uint256(vault.reservedPrincipal()) + 1;
        uint256 fees = uint256(vault.reservedFees()) - 1;
        vm.store(address(vault), bytes32(uint256(5)), bytes32(principal << 128 | uint256(vault.freeBalance())));
        vm.store(address(vault), bytes32(uint256(6)), bytes32(uint256(vault.totalDeposited()) << 128 | fees));
        (,, uint128 stored,,,) = vault.awards(id);
        require(stored == floorFee && vault.reservedFees() == fees, "legacy award in place");
    }

    /// An award reserved before fees rounded up holds floor(gross / 50). A signed month that includes it
    /// counts it once, as the same obligation, instead of reverting the whole month.
    function test_monthlyCountsAPreUpgradeFloorFeeAwardOnce() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6 + 1, 300e6);
        bytes32 source = entries[1].sourceDigest;
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 12, 200e6 + 1, source);
        reserveWithFloorFee(id);
        submit(PERIOD, entries, attest(AUTHORITY_KEY, vault, PERIOD, entries));
        require(vault.monthlyRoots(PERIOD) == vault.allocationRoot(entries), "month completes");
        require(vault.freeBalance() == 10_000e6 - (600e6 + 1), "each source reserved once");
        (,, uint128 fee,,,) = vault.awards(id);
        require(fee == 4_000_000, "the earlier award keeps its floor fee");
        // 100e6 and 300e6 pay ceil fees of 2e6 and 6e6; the earlier award keeps 4_000_000.
        require(vault.reservedFees() == 2e6 + 4_000_000 + 6e6, "fees reserved once");
        require(vault.reservedPrincipal() + vault.reservedFees() == 600e6 + 1, "exact total reserved");
    }

    /// Any fee other than the new ceil fee or the legacy floor fee is a changed award and fails closed.
    function test_monthlyRejectsAnAwardWithAnyOtherFee() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6 + 1, 300e6);
        bytes32 source = entries[1].sourceDigest;
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 12, 200e6 + 1, source);
        bytes32 awardSlot = keccak256(abi.encode(id, uint256(11)));
        vm.store(address(vault), bytes32(uint256(awardSlot) + 1), bytes32(uint256(4_000_000 - 1)));
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.DuplicateAward.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == bytes32(0), "the month stays uncommitted");
    }

    function test_monthlyRejectsAConflictingManualAward() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes32 source = entries[1].sourceDigest;
        bytes32 id = vault.awardId(source);
        vm.prank(OWNER);
        vault.commitAward(id, 12, 199e6, source);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.DuplicateAward.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.monthlyRoots(PERIOD) == bytes32(0), "conflicting month stays uncommitted");
    }

    function test_emptyAllocationIsRejected() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = new ProjectEscrow.MonthlyAward[](0);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.commitMonthly(PERIOD, entries, "");
    }

    // ------------------------------------------------------------------
    // Cap, one commit per period, opt-out
    // ------------------------------------------------------------------

    function test_capBoundsTheMonthlyTotal() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory over = allocation(400e6, 300e6, 300e6 + 1);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, over);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyCapExceeded.selector);
        vault.commitMonthly(PERIOD, over, signature);
        ProjectEscrow.MonthlyAward[] memory exact = allocation(400e6, 300e6, 300e6);
        submit(PERIOD, exact, attest(AUTHORITY_KEY, vault, PERIOD, exact));
        require(vault.freeBalance() == 9_000e6, "exactly the cap");
    }

    function test_freeBalanceStillBoundsTheMonthlyTotal() public {
        vm.prank(OWNER);
        vault.setMonthlyCommitment(20_000e6, true);
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(5_000e6, 5_000e6, 1);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InsufficientFreeBalance.selector);
        vault.commitMonthly(PERIOD, entries, signature);
    }

    function test_onePeriodCommitsOnce() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory first = allocation(100e6, 100e6, 100e6);
        submit(PERIOD, first, attest(AUTHORITY_KEY, vault, PERIOD, first));
        // A second, separately signed allocation for the same period is refused, even within the cap.
        ProjectEscrow.MonthlyAward[] memory second = new ProjectEscrow.MonthlyAward[](1);
        second[0] = ProjectEscrow.MonthlyAward(14, 100e6, keccak256("2026-11/14"));
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, second);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyAlreadyCommitted.selector);
        vault.commitMonthly(PERIOD, second, signature);
        // The next period can be finalized once its calendar month is closed.
        vm.warp(DECEMBER_OPENS);
        submit(202612, second, attest(AUTHORITY_KEY, vault, 202612, second));
        require(vault.monthlyRoots(202612) == vault.allocationRoot(second), "next period");
    }

    function test_monthlyIsOffUntilTheOwnerTurnsItOnAndTheOwnerCanOptOut() public {
        vm.prank(OWNER);
        ProjectEscrow fresh = ProjectEscrow(factory.create(keccak256("fresh"), IERC20(address(usdc)), Purpose.Ordinary));
        require(!fresh.monthlyEnabled() && fresh.monthlyCap() == 0, "off by default");
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(1e6, 1e6, 1e6);
        bytes memory freshSignature = attest(AUTHORITY_KEY, fresh, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyDisabled.selector);
        fresh.commitMonthly(PERIOD, entries, freshSignature);

        // Only the owner sets the switch, and "on" needs a positive cap.
        vm.prank(SUBMITTER);
        vm.expectRevert(ProjectEscrow.Unauthorized.selector);
        vault.setMonthlyCommitment(1_000e6, false);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidInput.selector);
        vault.setMonthlyCommitment(0, true);

        // The owner opts out after the allocation is signed; the signature no longer commits.
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.prank(OWNER);
        vault.setMonthlyCommitment(1_000e6, false);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyDisabled.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        require(vault.freeBalance() == 10_000e6, "nothing reserved");
        // Turning it on again lets the same signed allocation commit inside its window.
        vm.prank(OWNER);
        vault.setMonthlyCommitment(1_000e6, true);
        submit(PERIOD, entries, signature);
    }

    // ------------------------------------------------------------------
    // Signature binding, replay and the attester
    // ------------------------------------------------------------------

    function test_signatureBindsVaultPeriodAndRoot() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        // Another period.
        bytes memory otherPeriod = attest(AUTHORITY_KEY, vault, 202610, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, otherPeriod);
        // Another root: any changed amount, actor, source or order.
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        ProjectEscrow.MonthlyAward[] memory changed = allocation(100e6, 200e6, 300e6 + 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, changed, signature);
        ProjectEscrow.MonthlyAward[] memory reordered = allocation(100e6, 200e6, 300e6);
        (reordered[0], reordered[1]) = (reordered[1], reordered[0]);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, reordered, signature);
        ProjectEscrow.MonthlyAward[] memory dropped = new ProjectEscrow.MonthlyAward[](2);
        (dropped[0], dropped[1]) = (entries[0], entries[1]);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, dropped, signature);
        // Another vault: a signature for this vault cannot commit in the owner's other vault.
        vm.prank(OWNER);
        ProjectEscrow other = ProjectEscrow(factory.create(keccak256("other"), IERC20(address(usdc)), Purpose.Ordinary));
        vm.prank(OWNER);
        usdc.approve(address(other), type(uint256).max);
        vm.prank(OWNER);
        other.deposit(1_000e6);
        vm.prank(OWNER);
        other.setMonthlyCommitment(1_000e6, true);
        require(other.allocationRoot(entries) == vault.allocationRoot(entries), "same root in both vaults");
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        other.commitMonthly(PERIOD, entries, signature);
        // The exact signature commits here.
        submit(PERIOD, entries, signature);
    }

    function test_signatureCannotReplay() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        submit(PERIOD, entries, signature);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.MonthlyAlreadyCommitted.selector);
        vault.commitMonthly(PERIOD, entries, signature);
        // The next period needs its own signature.
        vm.warp(DECEMBER_OPENS);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(202612, entries, signature);
    }

    function test_signatureCannotReplayOnAnotherChain() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory signature = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        vm.chainId(block.chainid + 1);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, signature);
    }

    function test_onlyTheCurrentIdentityAuthorityAttests() public {
        vm.warp(NOVEMBER_OPENS);
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes memory stranger = attest(STRANGER_KEY, vault, PERIOD, entries);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, stranger);
        // An empty signature is refused.
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, hex"");
        // A malleable high-s form of a valid signature is refused.
        bytes memory valid = attest(AUTHORITY_KEY, vault, PERIOD, entries);
        bytes memory malleable = highS(valid);
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, malleable);
        // After a rotation the old authority's signature fails and the new authority's commits.
        vm.prank(REGISTRAR);
        factory.proposeIdentityAuthority(vm.addr(NEXT_AUTHORITY_KEY));
        vm.warp(block.timestamp + 7 days);
        factory.executeIdentityAuthorityRotation();
        vm.prank(OWNER);
        vm.expectRevert(ProjectEscrow.InvalidAttestation.selector);
        vault.commitMonthly(PERIOD, entries, valid);
        submit(PERIOD, entries, attest(NEXT_AUTHORITY_KEY, vault, PERIOD, entries));
    }

    /// @dev The same point with s' = n - s and the other v recovers the same key; signedBy rejects it.
    function highS(bytes memory signature) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        return abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
    }

    // ------------------------------------------------------------------
    // Allocation root
    // ------------------------------------------------------------------

    function test_allocationRootIsTheDocumentedMerkleTree() public view {
        ProjectEscrow.MonthlyAward[] memory entries = allocation(100e6, 200e6, 300e6);
        bytes32[3] memory leaves;
        for (uint256 i; i < 3; ++i) {
            leaves[i] =
                keccak256(abi.encodePacked(uint8(0), entries[i].actorId, entries[i].gross, entries[i].sourceDigest));
        }
        bytes32 expected = keccak256(
            abi.encodePacked(uint8(1), keccak256(abi.encodePacked(uint8(1), leaves[0], leaves[1])), leaves[2])
        );
        require(vault.allocationRoot(entries) == expected, "three-leaf root");
        ProjectEscrow.MonthlyAward[] memory one = new ProjectEscrow.MonthlyAward[](1);
        one[0] = entries[0];
        require(vault.allocationRoot(one) == leaves[0], "one-leaf root is the leaf");
    }
}
