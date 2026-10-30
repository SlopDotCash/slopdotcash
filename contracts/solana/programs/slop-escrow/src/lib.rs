use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{
    self as token, Mint, TokenAccount, TokenInterface, TransferChecked,
};
mod token_policy;
use solana_sha256_hasher::hashv;
use token_policy::{admitted_mint, admitted_token_account};
declare_id!("7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ");
/// Zero-delay deployment is supported. Historical projects retain their recorded delay.
const MIN_BINDING_DELAY: i64 = 0;
const MAX_BINDING_DELAY: i64 = 30 * 86400;
/// Historical rotation delays remain bounded; new deployments use zero delay.
const MAX_ROTATION_DELAY: i64 = 90 * 86400;
/// A monthly allocation for calendar UTC month M can be recorded from this delay after M ends
/// until this delay after the next month ends (owner decision D1: 00:00 UTC on the 4th).
const MONTHLY_CUTOFF_DELAY: i64 = 72 * 3600;
/// The identity authority signs this prefix, the program ID, the project, the period (u32 LE,
/// YYYYMM), the allocation root, total, freeze time (i64 LE) and stored network domain.
pub const MONTHLY_MESSAGE_PREFIX: &[u8] = b"slop-monthly-allocation-v3";
/// The identity authority signs this prefix, the program ID, the project, the period, the
/// allocation root, total, unsettled and released gross (u64 LE) and stored network domain.
pub const MONTHLY_RELEASE_PREFIX: &[u8] = b"slop-monthly-release-v1";
/// The native Ed25519 signature verification program.
const ED25519_PROGRAM: Pubkey =
    anchor_lang::solana_program::pubkey::pubkey!("Ed25519SigVerify111111111111111111111111111");
/// Vetoes a project owner may record for an actor between two payments to that actor in
/// the project. Each veto can only delay the actor by one more binding delay, so this
/// bounds the owner's delay power. The cap is waived, and the count untouched, while the
/// project has a confirmed pending authority rotation, so an earlier veto never shortens
/// the cover the owner can give during a key compromise.
const MAX_VETOES_BETWEEN_PAYMENTS: u8 = 3;
/// Each award and each unused-funds withdrawal pays 1/50 (2%) of its gross to the fee
/// recipient, rounded up once per award or withdrawal (PRD section 18), so splitting an amount
/// never lowers the fee. One rate for both
/// stops an owner from awarding free funds to itself to pay a lower fee than a withdrawal (#907).
const FEE_DIVISOR: u64 = 50;
/// Size of a Project created before accrued fees and the monthly gate were added.
const LEGACY_PROJECT_SIZE: usize = 316;
#[program]
pub mod slop_escrow {
    use super::*;
    // Writes the separate identity, fee and rotation authorities once. Only the
    // program's upgrade authority can sign it, so it must run before the upgrade authority
    // is revoked. No instruction changes or closes the Config afterwards.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        identity_authority: Pubkey,
        fee_recipient: Pubkey,
        rotation_authority: Pubkey,
    ) -> Result<()> {
        require!(
            identity_authority != Pubkey::default()
                && fee_recipient != Pubkey::default()
                && rotation_authority != Pubkey::default()
                && identity_authority != fee_recipient
                && rotation_authority != identity_authority
                && rotation_authority != fee_recipient,
            EscrowError::InvalidIdentity
        );
        let c = &mut ctx.accounts.config;
        c.identity_authority = identity_authority;
        c.fee_recipient = fee_recipient;
        c.rotation_authority = rotation_authority;
        c.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            identity_authority,
            fee_recipient,
            rotation_authority
        });
        Ok(())
    }
    pub fn initialize(
        ctx: Context<Initialize>,
        project_id: [u8; 32],
        network: [u8; 32],
        identity_authority: Pubkey,
        fee_recipient: Pubkey,
        binding_delay: i64,
        rotation_delay: i64,
        purpose: Purpose,
    ) -> Result<()> {
        require!(
            identity_authority != Pubkey::default()
                && fee_recipient != Pubkey::default()
                && identity_authority != ctx.accounts.owner.key()
                && identity_authority != fee_recipient
                && fee_recipient != ctx.accounts.owner.key()
                && fee_recipient != ctx.accounts.project.key()
                && ctx.accounts.owner.key() != ctx.accounts.config.rotation_authority,
            EscrowError::InvalidIdentity
        );
        // L-3: a new project uses only the identity authority and fee recipient that the
        // upgrade authority pinned in Config.
        require!(
            identity_authority == ctx.accounts.config.identity_authority
                && fee_recipient == ctx.accounts.config.fee_recipient,
            EscrowError::ConfigMismatch
        );
        require!(
            valid_delay(binding_delay) && valid_rotation_delay(rotation_delay),
            EscrowError::InvalidDelay
        );
        let p = &mut ctx.accounts.project;
        p.owner = ctx.accounts.owner.key();
        p.project_id = project_id;
        p.network = network;
        p.identity_authority = identity_authority;
        p.fee_recipient = fee_recipient;
        p.mint = ctx.accounts.mint.key();
        p.bump = ctx.bumps.project;
        p.binding_delay = binding_delay;
        p.rotation_delay = rotation_delay;
        p.purpose = purpose;
        Ok(())
    }
    /// SOL stays in a program-owned vault, never a wrapped token account. The asset sentinel
    /// occupies the existing immutable mint field, so existing Project layouts are unchanged.
    pub fn initialize_native(
        ctx: Context<InitializeNative>,
        project_id: [u8; 32],
        network: [u8; 32],
        identity_authority: Pubkey,
        fee_recipient: Pubkey,
        binding_delay: i64,
        rotation_delay: i64,
        purpose: Purpose,
    ) -> Result<()> {
        require!(
            identity_authority != Pubkey::default()
                && fee_recipient != Pubkey::default()
                && identity_authority != ctx.accounts.owner.key()
                && identity_authority != fee_recipient
                && fee_recipient != ctx.accounts.owner.key()
                && fee_recipient != ctx.accounts.project.key()
                && ctx.accounts.owner.key() != ctx.accounts.config.rotation_authority,
            EscrowError::InvalidIdentity
        );
        // L-3: a new project uses only the identity authority and fee recipient that the
        // upgrade authority pinned in Config.
        require!(
            identity_authority == ctx.accounts.config.identity_authority
                && fee_recipient == ctx.accounts.config.fee_recipient,
            EscrowError::ConfigMismatch
        );
        require!(
            valid_delay(binding_delay) && valid_rotation_delay(rotation_delay),
            EscrowError::InvalidDelay
        );
        let p = &mut ctx.accounts.project;
        p.owner = ctx.accounts.owner.key();
        p.project_id = project_id;
        p.network = network;
        p.identity_authority = identity_authority;
        p.fee_recipient = fee_recipient;
        p.mint = anchor_lang::system_program::ID;
        p.bump = ctx.bumps.project;
        p.binding_delay = binding_delay;
        p.rotation_delay = rotation_delay;
        p.purpose = purpose;
        Ok(())
    }
    // The owner starts a public two-party rotation of the identity authority. The current
    // authority has no instruction that can block it.
    pub fn propose_authority_rotation(
        ctx: Context<ProposeAuthorityRotation>,
        next: Pubkey,
    ) -> Result<()> {
        let p = &mut ctx.accounts.project;
        require!(
            next != Pubkey::default()
                && next != p.identity_authority
                && next != p.owner
                && next != p.fee_recipient
                && next != ctx.accounts.config.rotation_authority,
            EscrowError::InvalidIdentity
        );
        require!(
            p.pending_identity_authority == Pubkey::default(),
            EscrowError::RotationPending
        );
        let effective_at = add_i64(Clock::get()?.unix_timestamp, p.rotation_delay)?;
        p.pending_identity_authority = next;
        p.rotation_effective_at = effective_at;
        p.rotation_confirmed = false;
        emit!(AuthorityRotationProposed {
            project: p.key(),
            current: p.identity_authority,
            proposed: next,
            effective_at
        });
        Ok(())
    }
    // The independent rotation authority confirms; fee-conversion keys have no such power.
    pub fn confirm_authority_rotation(ctx: Context<ConfirmAuthorityRotation>) -> Result<()> {
        let p = &mut ctx.accounts.project;
        require!(
            p.pending_identity_authority != Pubkey::default(),
            EscrowError::NoRotationPending
        );
        require!(!p.rotation_confirmed, EscrowError::RotationConfirmed);
        p.rotation_confirmed = true;
        emit!(AuthorityRotationConfirmed {
            project: p.key(),
            proposed: p.pending_identity_authority
        });
        Ok(())
    }
    // The owner withdraws its own proposal; nobody else can.
    pub fn cancel_authority_rotation(ctx: Context<CancelAuthorityRotation>) -> Result<()> {
        let p = &mut ctx.accounts.project;
        let proposed = p.pending_identity_authority;
        require!(
            proposed != Pubkey::default(),
            EscrowError::NoRotationPending
        );
        p.pending_identity_authority = Pubkey::default();
        p.rotation_effective_at = 0;
        p.rotation_confirmed = false;
        emit!(AuthorityRotationCancelled {
            project: p.key(),
            proposed
        });
        Ok(())
    }
    // Anyone executes a confirmed proposal once its delay has passed. Binding PDAs derive from
    // the project and actor, not the authority, so every existing binding stays valid.
    pub fn execute_authority_rotation(ctx: Context<ExecuteAuthorityRotation>) -> Result<()> {
        let p = &mut ctx.accounts.project;
        let next = p.pending_identity_authority;
        require!(next != Pubkey::default(), EscrowError::NoRotationPending);
        require!(p.rotation_confirmed, EscrowError::RotationUnconfirmed);
        require!(
            Clock::get()?.unix_timestamp >= p.rotation_effective_at,
            EscrowError::RotationNotReady
        );
        let previous = p.identity_authority;
        p.identity_authority = next;
        p.pending_identity_authority = Pubkey::default();
        p.rotation_effective_at = 0;
        p.rotation_confirmed = false;
        emit!(AuthorityRotated {
            project: p.key(),
            previous,
            current: next
        });
        Ok(())
    }
    // Anyone can fund a project. The deposit is credited to `deposited` and becomes free
    // balance; only the owner can commit it or withdraw it.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.project.deposited = add(ctx.accounts.project.deposited, amount)?;
        emit!(Deposited {
            project: ctx.accounts.project.key(),
            depositor: ctx.accounts.depositor.key(),
            amount
        });
        Ok(())
    }
    pub fn deposit_native(ctx: Context<DepositNative>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        // Check the existing vault, including its permanent rent reserve, before accepting funds.
        vault_amount(&ctx.accounts.vault, &ctx.accounts.project)?;
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        ctx.accounts.project.deposited = add(ctx.accounts.project.deposited, amount)?;
        emit!(Deposited {
            project: ctx.accounts.project.key(),
            depositor: ctx.accounts.depositor.key(),
            amount
        });
        Ok(())
    }
    pub fn commit(
        mut ctx: Context<Commit>,
        award_id: [u8; 32],
        source_digest: [u8; 32],
        actor_id: u64,
        gross: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.project.purpose == Purpose::Ordinary,
            EscrowError::WrongPurpose
        );
        // While an admitted month has uncommitted awards, the owner cannot consume one of
        // their sources by hand and strand that award; anyone can commit the rest first.
        // Time and owner opt-out never remove this funded-source protection.
        require!(
            ctx.accounts.project.monthly_outstanding == 0,
            EscrowError::MonthlyOutstanding
        );
        let a = &mut ctx.accounts;
        commit_with_fee(
            &mut a.project,
            &a.vault,
            &mut a.origin,
            &mut a.obligation,
            award_id,
            source_digest,
            actor_id,
            gross,
            fee_for(gross),
        )
    }
    /// Bounties reuse ordinary reserves, destination authorization and recovery, in a
    /// bounty-purpose project only.
    pub fn commit_bounty(
        mut ctx: Context<Commit>,
        award_id: [u8; 32],
        source_digest: [u8; 32],
        actor_id: u64,
        gross: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.project.purpose == Purpose::Bounty,
            EscrowError::WrongPurpose
        );
        require!(gross % 4 == 0, EscrowError::InvalidAmount);
        let a = &mut ctx.accounts;
        commit_with_fee(
            &mut a.project,
            &a.vault,
            &mut a.origin,
            &mut a.obligation,
            award_id,
            source_digest,
            actor_id,
            gross,
            gross / 4,
        )
    }
    // The owner sets the monthly cap and turns monthly commitments on or off. While they are
    // off, no new monthly allocation can be recorded. Already reserved awards remain available.
    pub fn set_monthly_commitment(
        ctx: Context<SetMonthlyCommitment>,
        cap: u64,
        enabled: bool,
    ) -> Result<()> {
        let p = &mut ctx.accounts.project;
        require!(p.purpose == Purpose::Ordinary, EscrowError::WrongPurpose);
        require!(!enabled || cap > 0, EscrowError::InvalidAmount);
        p.monthly_cap = cap;
        p.monthly_enabled = enabled;
        emit!(MonthlyCommitmentSet {
            project: p.key(),
            cap,
            enabled
        });
        Ok(())
    }
    // Anyone records one period's allocation root inside the period's window, once per
    // period, while the owner has monthly commitments on. The instruction just before this
    // one must be an Ed25519 program check of the project's identity authority signature
    // over monthly_message(program, project, period, root, total, frozen_at, network).
    // `frozen_at` is when the attester froze the allocation, after it checked that no
    // included source was consumed; only a source consumed before it can be released.
    pub fn commit_monthly(
        ctx: Context<CommitMonthly>,
        period: u32,
        allocation_root: [u8; 32],
        total: u64,
        frozen_at: i64,
    ) -> Result<()> {
        let p = &mut ctx.accounts.project;
        require!(p.purpose == Purpose::Ordinary, EscrowError::WrongPurpose);
        require!(p.monthly_enabled, EscrowError::MonthlyDisabled);
        let (opens_at, closes_at) = monthly_window(period)?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= opens_at && now < closes_at,
            EscrowError::MonthlyWindowClosed
        );
        require!(
            frozen_at >= opens_at && frozen_at <= now,
            EscrowError::InvalidFreeze
        );
        require!(total > 0, EscrowError::InvalidAmount);
        require!(total <= p.monthly_cap, EscrowError::MonthlyCapExceeded);
        require!(
            free(p)? >= total && vault_amount(&ctx.accounts.vault, p)? >= add(held(p)?, total)?,
            EscrowError::InsufficientFreeBalance
        );
        let message = monthly_message(
            ctx.program_id,
            &p.key(),
            period,
            &allocation_root,
            total,
            frozen_at,
            &p.network,
        );
        verify_attestation(&ctx.accounts.instructions, &p.identity_authority, &message)?;
        let m = &mut ctx.accounts.month;
        m.project = p.key();
        m.period = period;
        m.allocation_root = allocation_root;
        m.committed = 0;
        m.released = 0;
        m.frozen_at = frozen_at;
        m.expired = false;
        m.total = total;
        p.reserved = add(p.reserved, total)?;
        p.monthly_outstanding = add(p.monthly_outstanding, total)?;
        emit!(MonthlyCommitted {
            project: p.key(),
            period,
            allocation_root,
            total
        });
        Ok(())
    }
    // Anyone commits one award of a recorded allocation with its Merkle proof. The award
    // takes the ordinary fee from the period's existing reservation.
    // The origin PDA commits each source once.
    #[allow(clippy::too_many_arguments)]
    pub fn commit_monthly_award(
        mut ctx: Context<CommitMonthlyAward>,
        period: u32,
        award_id: [u8; 32],
        source_digest: [u8; 32],
        actor_id: u64,
        gross: u64,
        index: u32,
        count: u32,
        proof: Vec<AllocationNode>,
    ) -> Result<()> {
        let _ = period;
        // An admitted month is already funded. Later opt-out or cap changes
        // affect new admissions, never these reserved obligations.
        let a = &mut ctx.accounts;
        // Move an existing reservation into an obligation. The common commit
        // path adds it back; any failure rolls back the complete instruction.
        settle_leaf(
            &mut a.project,
            &mut a.month,
            actor_id,
            gross,
            &source_digest,
            index,
            count,
            &proof,
        )?;
        commit_with_fee(
            &mut a.project,
            &a.vault,
            &mut a.origin,
            &mut a.obligation,
            award_id,
            source_digest,
            actor_id,
            gross,
            fee_for(gross),
        )
    }
    // Anyone returns one award of a recorded allocation to free balance when it can never
    // commit: its source already pays the same actor at least as much, or was consumed by
    // hand before the allocation froze, or its actor is zero. A source the owner consumes
    // after the freeze with a smaller award or one to another actor stays reserved, so
    // selective removal never becomes a refund. The `settled` marker,
    // shared with commit_monthly_award, lets each source of a month settle only once.
    #[allow(clippy::too_many_arguments)]
    pub fn release_monthly_award(
        mut ctx: Context<ReleaseMonthlyAward>,
        period: u32,
        source_digest: [u8; 32],
        actor_id: u64,
        gross: u64,
        index: u32,
        count: u32,
        proof: Vec<AllocationNode>,
    ) -> Result<()> {
        require!(gross > 0, EscrowError::AwardCommittable);
        if actor_id != 0 {
            let origin = &ctx.accounts.origin;
            require!(
                origin.owner == ctx.program_id && !origin.data_is_empty(),
                EscrowError::AwardCommittable
            );
            let recorded = Origin::try_deserialize(&mut &origin.try_borrow_data()?[..])?;
            let consumed = ctx
                .accounts
                .obligation
                .as_ref()
                .ok_or(error!(EscrowError::AwardCommittable))?;
            require!(
                consumed.key() == recorded.obligation,
                EscrowError::AwardCommittable
            );
            // The source already pays this actor at least this gross (an identical hand
            // award, which EVM counts once, a larger one, or another month's award), or the
            // owner consumed it by hand before the freeze, which it may do. A smaller award or
            // one to another actor after the freeze leaves this gross reserved rather than
            // refunding the gap.
            // Gross and the principal the contributor receives, so a migrated obligation
            // with another fee can never under-pay.
            let pays_actor = consumed.actor_id == actor_id
                && consumed.gross >= gross
                && consumed.principal >= gross - fee_for(gross);
            require!(
                pays_actor || consumed.committed_at < ctx.accounts.month.frozen_at,
                EscrowError::AwardCommittable
            );
        }
        let a = &mut ctx.accounts;
        settle_leaf(
            &mut a.project,
            &mut a.month,
            actor_id,
            gross,
            &source_digest,
            index,
            count,
            &proof,
        )?;
        a.month.released = add(a.month.released, gross)?;
        emit!(MonthlyAwardReleased {
            project: a.project.key(),
            period,
            source_digest,
            actor_id,
            gross
        });
        Ok(())
    }
    // The owner returns `released` gross of a recorded month that can never settle (an
    // attester fault) to free balance. The instruction just before this one must be an
    // Ed25519 program check of the project's identity authority signature over
    // monthly_release_message for the month's current unsettled gross, so a leaf that
    // settles first makes it stale. Committed awards do not change. Time alone never
    // releases a reserve, and the period stays recorded. A leaf still settles while its
    // gross fits the unsettled remainder.
    pub fn release_monthly_reserve(
        ctx: Context<ReleaseMonthlyReserve>,
        period: u32,
        expected_unsettled: u64,
        released: u64,
    ) -> Result<()> {
        let p = &mut ctx.accounts.project;
        let m = &mut ctx.accounts.month;
        let unsettled = m
            .total
            .checked_sub(m.committed)
            .ok_or(EscrowError::Arithmetic)?;
        require!(
            unsettled == expected_unsettled,
            EscrowError::MonthlyReserveChanged
        );
        require!(
            released > 0 && released <= unsettled,
            EscrowError::InvalidAmount
        );
        let message = monthly_release_message(
            ctx.program_id,
            &p.key(),
            period,
            &m.allocation_root,
            m.total,
            unsettled,
            released,
            &p.network,
        );
        verify_attestation(&ctx.accounts.instructions, &p.identity_authority, &message)?;
        m.committed = add(m.committed, released)?;
        m.released = add(m.released, released)?;
        let less = |n: u64| {
            n.checked_sub(released)
                .ok_or(error!(EscrowError::Arithmetic))
        };
        p.reserved = less(p.reserved)?;
        // As in settle_leaf: a legacy expired month already left the outstanding count.
        if !m.expired {
            p.monthly_outstanding = less(p.monthly_outstanding)?;
        }
        emit!(MonthlyReserveReleased {
            project: p.key(),
            period,
            unsettled,
            released
        });
        Ok(())
    }
    // The attester and the destination keypair both sign this exact transaction, including
    // deployment, project and predecessor. The destination is a co-signer, so the authority
    // alone cannot bind a wallet it does not hold. `expires_at` limits submission, not claim
    // lifetime. A new binding replaces the latest one for this project; no earlier binding
    // can pay afterwards.
    pub fn bind_wallet(
        ctx: Context<BindWallet>,
        actor_id: u64,
        network: [u8; 32],
        expected_version: u64,
        claim_digest: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        let destination = ctx.accounts.destination.key();
        let project = ctx.accounts.project.key();
        let vault = Pubkey::find_program_address(&[b"vault", project.as_ref()], ctx.program_id).0;
        // A destination owned by the project or vault PDA would strand the principal.
        require!(
            actor_id > 0
                && destination != ctx.accounts.identity_authority.key()
                && destination != project
                && destination != vault
                && claim_digest != [0u8; 32],
            EscrowError::InvalidIdentity
        );
        require!(
            Clock::get()?.unix_timestamp < expires_at,
            EscrowError::BindingExpired
        );
        require!(
            network == ctx.accounts.project.network,
            EscrowError::WrongNetwork
        );
        let b = &mut ctx.accounts.binding;
        require!(b.version == expected_version, EscrowError::StaleBinding);
        b.actor_id = actor_id;
        b.network = network;
        b.authority = ctx.accounts.identity_authority.key();
        b.destination = destination;
        b.claim_digest = claim_digest;
        b.version = add(expected_version, 1)?;
        b.bound_at = Clock::get()?.unix_timestamp;
        emit!(WalletBound {
            actor_id,
            network,
            destination,
            version: b.version,
            bound_at: b.bound_at
        });
        Ok(())
    }
    // The owner may veto the latest unpaid binding during its review period or the named award's
    // commit period. Payment is immediately eligible after a verified bind if the award has matured:
    // a veto must execute before payment. The cap is waived during a confirmed authority rotation.
    pub fn veto_binding(ctx: Context<VetoBinding>, actor_id: u64, version: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        let b = &ctx.accounts.binding;
        require!(
            b.version == version && b.actor_id == actor_id && version > 0,
            EscrowError::StaleBinding
        );
        require!(version != b.paid_version, EscrowError::BindingActive);
        let now = Clock::get()?.unix_timestamp;
        let commit_window = match &ctx.accounts.obligation {
            Some(a) => now < add_i64(a.committed_at, p.binding_delay)?,
            None => false,
        };
        require!(
            now < binding_review_ends_at(b, p)? || commit_window,
            EscrowError::BindingActive
        );
        let rotation_pending =
            p.pending_identity_authority != Pubkey::default() && p.rotation_confirmed;
        if !rotation_pending {
            require!(
                b.veto_count < MAX_VETOES_BETWEEN_PAYMENTS,
                EscrowError::VetoLimit
            );
            ctx.accounts.binding.veto_count += 1;
        }
        emit!(BindingVetoed {
            project: ctx.accounts.project.key(),
            actor_id,
            version
        });
        Ok(())
    }
    // Pays a matured award to the latest verified, unvetoed binding without another wallet wait.
    pub fn pay(ctx: Context<Pay>, expected_version: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        let a = &ctx.accounts.obligation;
        let b = &ctx.accounts.binding;
        require!(!a.paid, EscrowError::AlreadyPaid);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= add_i64(a.committed_at, p.binding_delay)?,
            EscrowError::AwardPending
        );
        require!(b.version > 0, EscrowError::StaleBinding);
        // A veto address can only be created by veto_binding; an empty system account
        // proves the owner did not veto that binding version.
        require!(unvetoed(&ctx.accounts.veto), EscrowError::BindingVetoed);
        require!(b.version == expected_version, EscrowError::StaleBinding);
        let (destination, version) = (b.destination, b.version);
        require!(
            ctx.accounts.destination.owner == destination
                && ctx.accounts.destination.key()
                    == get_associated_token_address_with_program_id(
                        &destination,
                        &ctx.accounts.mint.key(),
                        &ctx.accounts.token_program.key(),
                    ),
            EscrowError::WrongDestination
        );
        let (purpose, bump) = ([p.purpose as u8], [p.bump]);
        let seeds: &[&[u8]] = &[b"project", p.owner.as_ref(), &p.project_id, &purpose, &bump];
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.mint,
            p,
            seeds,
            a.principal,
        )?;
        let principal = a.principal;
        let fee = a.fee;
        let p = &mut ctx.accounts.project;
        p.reserved = p
            .reserved
            .checked_sub(add(principal, fee)?)
            .ok_or(EscrowError::Arithmetic)?;
        p.paid = add(p.paid, principal)?;
        p.payout_fees = add(p.payout_fees, fee)?;
        // The fee stays in the vault until claim_fees, so the fee recipient's token account
        // can never stop a payout (L-2).
        p.accrued_fees = add(p.accrued_fees, fee)?;
        ctx.accounts.obligation.paid = true;
        let b = &mut ctx.accounts.binding;
        b.paid_version = version;
        b.veto_count = 0;
        emit!(AwardPaid {
            project: p.key(),
            award_id: ctx.accounts.obligation.award_id,
            gross: ctx.accounts.obligation.gross,
            principal,
            fee,
            destination,
            wallet_version: version
        });
        Ok(())
    }
    pub fn pay_native(ctx: Context<PayNative>, expected_version: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        let a = &ctx.accounts.obligation;
        let b = &ctx.accounts.binding;
        require!(!a.paid, EscrowError::AlreadyPaid);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= add_i64(a.committed_at, p.binding_delay)?,
            EscrowError::AwardPending
        );
        require!(b.version > 0, EscrowError::StaleBinding);
        // A veto address can only be created by veto_binding; an empty system account
        // proves the owner did not veto that binding version.
        require!(unvetoed(&ctx.accounts.veto), EscrowError::BindingVetoed);
        require!(b.version == expected_version, EscrowError::StaleBinding);
        let (destination, version) = (b.destination, b.version);
        require_keys_eq!(
            ctx.accounts.destination.key(),
            destination,
            EscrowError::WrongDestination
        );
        send_native(
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            p,
            a.principal,
        )?;
        let principal = a.principal;
        let fee = a.fee;
        let p = &mut ctx.accounts.project;
        p.reserved = p
            .reserved
            .checked_sub(add(principal, fee)?)
            .ok_or(EscrowError::Arithmetic)?;
        p.paid = add(p.paid, principal)?;
        p.payout_fees = add(p.payout_fees, fee)?;
        // The fee stays in the vault until claim_fees, so the fee recipient's token account
        // can never stop a payout (L-2).
        p.accrued_fees = add(p.accrued_fees, fee)?;
        ctx.accounts.obligation.paid = true;
        let b = &mut ctx.accounts.binding;
        b.paid_version = version;
        b.veto_count = 0;
        emit!(AwardPaid {
            project: p.key(),
            award_id: ctx.accounts.obligation.award_id,
            gross: ctx.accounts.obligation.gross,
            principal,
            fee,
            destination,
            wallet_version: version
        });
        Ok(())
    }
    pub fn withdraw(ctx: Context<Withdraw>, gross: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        require!(
            gross > 0 && ctx.accounts.vault.amount >= add(held(p)?, gross)? && free(p)? >= gross,
            EscrowError::InsufficientFreeBalance
        );
        let fee = fee_for(gross);
        let returned = gross.checked_sub(fee).ok_or(EscrowError::Arithmetic)?;
        let (purpose, bump) = ([p.purpose as u8], [p.bump]);
        let seeds: &[&[u8]] = &[b"project", p.owner.as_ref(), &p.project_id, &purpose, &bump];
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.mint,
            p,
            seeds,
            returned,
        )?;
        let p = &mut ctx.accounts.project;
        p.withdrawn_gross = add(p.withdrawn_gross, gross)?;
        p.withdrawal_fees = add(p.withdrawal_fees, fee)?;
        p.accrued_fees = add(p.accrued_fees, fee)?;
        emit!(UnusedWithdrawn {
            project: p.key(),
            gross,
            fee,
            returned
        });
        Ok(())
    }
    pub fn withdraw_native(ctx: Context<WithdrawNative>, gross: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        require!(
            gross > 0
                && vault_amount(&ctx.accounts.vault, p)? >= add(held(p)?, gross)?
                && free(p)? >= gross,
            EscrowError::InsufficientFreeBalance
        );
        let fee = fee_for(gross);
        let returned = gross.checked_sub(fee).ok_or(EscrowError::Arithmetic)?;
        send_native(&ctx.accounts.vault, &ctx.accounts.destination, p, returned)?;
        let p = &mut ctx.accounts.project;
        p.withdrawn_gross = add(p.withdrawn_gross, gross)?;
        p.withdrawal_fees = add(p.withdrawal_fees, fee)?;
        p.accrued_fees = add(p.accrued_fees, fee)?;
        emit!(UnusedWithdrawn {
            project: p.key(),
            gross,
            fee,
            returned
        });
        Ok(())
    }
    // Anyone grows a Project created by the 316-byte build to the current layout, paying
    // any extra rent. The new counters start at zero: that build sent fees out at once and
    // had no monthly gate. No other instruction can read the old layout.
    pub fn migrate_project(ctx: Context<MigrateProject>) -> Result<()> {
        let info = ctx.accounts.project.to_account_info();
        require!(
            info.owner == ctx.program_id
                && info.data_len() == LEGACY_PROJECT_SIZE
                && info.try_borrow_data()?[..8] == *Project::DISCRIMINATOR,
            EscrowError::NotLegacyProject
        );
        let size = 8 + Project::INIT_SPACE;
        let lacking = Rent::get()?
            .minimum_balance(size)
            .saturating_sub(info.lamports());
        if lacking > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: info.clone(),
                    },
                ),
                lacking,
            )?;
        }
        info.realloc(size, true)?;
        emit!(ProjectMigrated {
            project: info.key()
        });
        Ok(())
    }
    // Anyone moves the accrued payout and withdrawal fees to a token account the fee recipient
    // owns. Only this instruction depends on the fee recipient, as on EVM.
    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        let p = &ctx.accounts.project;
        let amount = p.accrued_fees;
        require!(amount > 0, EscrowError::InvalidAmount);
        let (purpose, bump) = ([p.purpose as u8], [p.bump]);
        let seeds: &[&[u8]] = &[b"project", p.owner.as_ref(), &p.project_id, &purpose, &bump];
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.fee_account,
            &ctx.accounts.mint,
            p,
            seeds,
            amount,
        )?;
        let p = &mut ctx.accounts.project;
        p.accrued_fees = 0;
        emit!(FeesClaimed {
            project: p.key(),
            fee_account: ctx.accounts.fee_account.key(),
            amount
        });
        Ok(())
    }
    pub fn claim_fees_native(ctx: Context<ClaimFeesNative>) -> Result<()> {
        let p = &ctx.accounts.project;
        let amount = p.accrued_fees;
        require!(amount > 0, EscrowError::InvalidAmount);
        send_native(&ctx.accounts.vault, &ctx.accounts.fee_account, p, amount)?;
        let p = &mut ctx.accounts.project;
        p.accrued_fees = 0;
        emit!(FeesClaimed {
            project: p.key(),
            fee_account: ctx.accounts.fee_account.key(),
            amount
        });
        Ok(())
    }
}
/// The only valid award ID for a source in this project.
pub fn award_id_for(project: &Pubkey, source_digest: &[u8; 32]) -> [u8; 32] {
    hashv(&[b"slop-escrow-award", project.as_ref(), source_digest]).to_bytes()
}
#[allow(clippy::too_many_arguments)]
fn commit_with_fee(
    p: &mut Account<Project>,
    vault: &UncheckedAccount,
    origin: &mut Account<Origin>,
    a: &mut Account<Obligation>,
    award_id: [u8; 32],
    source_digest: [u8; 32],
    actor_id: u64,
    gross: u64,
    fee: u64,
) -> Result<()> {
    require!(gross > 0 && actor_id > 0, EscrowError::InvalidAmount);
    // Binding the project to the ID stops another project from claiming it first.
    require!(
        award_id == award_id_for(&p.key(), &source_digest),
        EscrowError::InvalidAward
    );
    let principal = gross - fee;
    let reserve = gross;
    require!(
        vault_amount(vault, p)? >= add(held(p)?, reserve)? && free(p)? >= reserve,
        EscrowError::InsufficientFreeBalance
    );
    p.reserved = add(p.reserved, reserve)?;
    a.project = p.key();
    a.award_id = award_id;
    a.source_digest = source_digest;
    origin.obligation = a.key();
    a.actor_id = actor_id;
    a.gross = gross;
    a.principal = principal;
    a.fee = fee;
    a.committed_at = Clock::get()?.unix_timestamp;
    emit!(AwardCommitted {
        project: p.key(),
        award_id,
        source_digest,
        actor_id,
        gross,
        principal,
        fee
    });
    Ok(())
}

/// Proves one leaf against the recorded month and moves its gross out of the month's
/// reservation and outstanding total. The caller commits it or leaves it free.
#[allow(clippy::too_many_arguments)]
fn settle_leaf(
    p: &mut Account<Project>,
    month: &mut Account<MonthlyAllocation>,
    actor_id: u64,
    gross: u64,
    source_digest: &[u8; 32],
    index: u32,
    count: u32,
    proof: &[AllocationNode],
) -> Result<()> {
    let leaf = AllocationNode {
        hash: monthly_leaf(actor_id, gross, source_digest),
        total: gross,
    };
    let root = merkle_sum_root(leaf, index, count, proof)?;
    require!(
        root.hash == month.allocation_root && root.total == month.total,
        EscrowError::InvalidAllocationProof
    );
    let committed = add(month.committed, gross)?;
    require!(committed <= month.total, EscrowError::MonthlyCapExceeded);
    month.committed = committed;
    let less = |n: u64| n.checked_sub(gross).ok_or(error!(EscrowError::Arithmetic));
    p.reserved = less(p.reserved)?;
    // Compatibility with previously expired accounts: their gross already left
    // the outstanding count. New funded months never expire.
    if !month.expired {
        p.monthly_outstanding = less(p.monthly_outstanding)?;
    }
    Ok(())
}
/// The bytes the identity authority signs for one period's allocation of one project.
pub fn monthly_message(
    program_id: &Pubkey,
    project: &Pubkey,
    period: u32,
    allocation_root: &[u8; 32],
    total: u64,
    frozen_at: i64,
    network: &[u8; 32],
) -> Vec<u8> {
    [
        MONTHLY_MESSAGE_PREFIX,
        program_id.as_ref(),
        project.as_ref(),
        &period.to_le_bytes(),
        allocation_root,
        &total.to_le_bytes(),
        &frozen_at.to_le_bytes(),
        network,
    ]
    .concat()
}
/// The bytes the identity authority signs to state that `released` of a recorded month's
/// `unsettled` gross can never settle.
#[allow(clippy::too_many_arguments)]
pub fn monthly_release_message(
    program_id: &Pubkey,
    project: &Pubkey,
    period: u32,
    allocation_root: &[u8; 32],
    total: u64,
    unsettled: u64,
    released: u64,
    network: &[u8; 32],
) -> Vec<u8> {
    [
        MONTHLY_RELEASE_PREFIX,
        program_id.as_ref(),
        project.as_ref(),
        &period.to_le_bytes(),
        allocation_root,
        &total.to_le_bytes(),
        &unsettled.to_le_bytes(),
        &released.to_le_bytes(),
        network,
    ]
    .concat()
}
/// A leaf of the allocation tree: sha256(0x00, actor ID LE, gross LE, source digest).
pub fn monthly_leaf(actor_id: u64, gross: u64, source_digest: &[u8; 32]) -> [u8; 32] {
    hashv(&[
        &[0u8],
        &actor_id.to_le_bytes(),
        &gross.to_le_bytes(),
        source_digest,
    ])
    .to_bytes()
}
/// Each sibling authenticates both its digest and aggregate gross amount.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub struct AllocationNode {
    pub hash: [u8; 32],
    pub total: u64,
}
fn sum_node(left: AllocationNode, right: AllocationNode) -> Result<AllocationNode> {
    Ok(AllocationNode {
        hash: hashv(&[
            &[1u8],
            &left.hash,
            &left.total.to_le_bytes(),
            &right.hash,
            &right.total.to_le_bytes(),
        ])
        .to_bytes(),
        total: add(left.total, right.total)?,
    })
}
fn merkle_sum_root(
    leaf: AllocationNode,
    index: u32,
    count: u32,
    proof: &[AllocationNode],
) -> Result<AllocationNode> {
    require!(index < count, EscrowError::InvalidAllocationProof);
    let (mut node, mut index, mut width) = (leaf, index, count);
    let mut siblings = proof.iter();
    while width > 1 {
        if index % 2 == 1 || index + 1 < width {
            let sibling = *siblings
                .next()
                .ok_or(error!(EscrowError::InvalidAllocationProof))?;
            node = if index % 2 == 1 {
                sum_node(sibling, node)?
            } else {
                sum_node(node, sibling)?
            };
        }
        index /= 2;
        width = width.div_ceil(2);
    }
    require!(
        siblings.next().is_none(),
        EscrowError::InvalidAllocationProof
    );
    Ok(node)
}
/// When a period (YYYYMM, UTC, year 2000 to 9999) may be recorded: from the cutoff delay after
/// the month ends until the cutoff delay after the next month ends. Only one period is open at
/// a time, so a stolen authority key can commit at most one cap per month.
fn monthly_window(period: u32) -> Result<(i64, i64)> {
    let (year, month) = ((period / 100) as i64, (period % 100) as i64);
    require!(
        (2000..=9999).contains(&year) && (1..=12).contains(&month),
        EscrowError::InvalidPeriod
    );
    let next = |(y, m): (i64, i64)| if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let first = next((year, month));
    let second = next(first);
    Ok((
        month_start(first.0, first.1) + MONTHLY_CUTOFF_DELAY,
        month_start(second.0, second.1) + MONTHLY_CUTOFF_DELAY,
    ))
}
/// Unix time of 00:00 UTC on the first day of a month (proleptic Gregorian, days from civil).
fn month_start(year: i64, month: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y / 400;
    let year_of_era = y - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era - 719_468) * 86_400
}
/// Requires that the instruction just before the current one is an Ed25519 program check of
/// exactly one signature by `signer` over exactly `message`, with every offset inside that
/// instruction's own data. The Ed25519 program fails the transaction if the signature is bad.
fn verify_attestation(
    instructions: &UncheckedAccount,
    signer: &Pubkey,
    message: &[u8],
) -> Result<()> {
    let info = instructions.to_account_info();
    let current = load_current_index_checked(&info)?;
    require!(current > 0, EscrowError::InvalidAttestation);
    let check = load_instruction_at_checked(current as usize - 1, &info)?;
    let data = &check.data;
    require!(
        check.program_id == ED25519_PROGRAM
            && check.accounts.is_empty()
            && data.len() >= 16
            && data[0] == 1,
        EscrowError::InvalidAttestation
    );
    let field = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]) as usize;
    // Offsets: signature, its instruction, public key, its instruction, message, size, its instruction.
    let (public_key, message_at, size) = (field(6), field(10), field(12));
    require!(
        field(4) == u16::MAX as usize
            && field(8) == u16::MAX as usize
            && field(14) == u16::MAX as usize
            && public_key + 32 <= data.len()
            && message_at + size <= data.len()
            && &data[public_key..public_key + 32] == signer.as_ref()
            && &data[message_at..message_at + size] == message,
        EscrowError::InvalidAttestation
    );
    Ok(())
}

/// The 2% fee on one award or one withdrawal of `gross`, rounded up, so a split into pieces
/// under 50 base units never avoids it. It depends only on this amount.
fn fee_for(gross: u64) -> u64 {
    gross.div_ceil(FEE_DIVISOR)
}
fn valid_delay(binding_delay: i64) -> bool {
    (MIN_BINDING_DELAY..=MAX_BINDING_DELAY).contains(&binding_delay)
}
fn valid_rotation_delay(rotation_delay: i64) -> bool {
    (MIN_BINDING_DELAY..=MAX_ROTATION_DELAY).contains(&rotation_delay)
}
fn binding_review_ends_at(b: &WalletBinding, p: &Project) -> Result<i64> {
    add_i64(b.bound_at, p.binding_delay)
}
fn add_i64(a: i64, b: i64) -> Result<i64> {
    a.checked_add(b).ok_or(error!(EscrowError::Arithmetic))
}
fn unvetoed(veto: &UncheckedAccount) -> bool {
    veto.data_is_empty() && veto.owner == &anchor_lang::system_program::ID
}
// Unsolicited token transfers do not acquire sponsor refund or award rights.
fn free(p: &Project) -> Result<u64> {
    p.deposited
        .checked_sub(p.paid)
        .and_then(|n| n.checked_sub(p.payout_fees))
        .and_then(|n| n.checked_sub(p.withdrawn_gross))
        .and_then(|n| n.checked_sub(p.reserved))
        .ok_or(error!(EscrowError::Arithmetic))
}
/// Tokens the vault must keep for others: reserved awards and accrued, unclaimed fees.
fn held(p: &Project) -> Result<u64> {
    add(p.reserved, p.accrued_fees)
}
fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(error!(EscrowError::Arithmetic))
}
/// Validate the immutable vault identity before using its balance for any reserve or transfer.
fn vault_amount(vault: &UncheckedAccount, project: &Account<Project>) -> Result<u64> {
    if project.mint == anchor_lang::system_program::ID {
        require!(
            vault.owner == project.to_account_info().owner && vault.data_is_empty(),
            EscrowError::WrongMint
        );
        return vault
            .lamports()
            .checked_sub(Rent::get()?.minimum_balance(0))
            .ok_or(error!(EscrowError::InsufficientFreeBalance));
    }
    require!(
        admitted_token_account(&vault.to_account_info())?,
        EscrowError::WrongMint
    );
    let data = vault.try_borrow_data()?;
    let token = TokenAccount::try_deserialize(&mut &data[..])?;
    require_keys_eq!(token.mint, project.mint, EscrowError::WrongMint);
    require_keys_eq!(token.owner, project.key(), EscrowError::WrongDestination);
    Ok(token.amount)
}
fn send_native<'info>(
    source: &UncheckedAccount<'info>,
    destination: &UncheckedAccount<'info>,
    project: &Account<'info, Project>,
    amount: u64,
) -> Result<()> {
    require!(
        project.mint == anchor_lang::system_program::ID,
        EscrowError::WrongMint
    );
    require_keys_neq!(
        source.key(),
        destination.key(),
        EscrowError::WrongDestination
    );
    require!(
        vault_amount(source, project)? >= amount,
        EscrowError::InsufficientFreeBalance
    );
    if amount > 0 {
        let remaining = source
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::Arithmetic)?;
        let received = add(destination.lamports(), amount)?;
        **source.try_borrow_mut_lamports()? = remaining;
        **destination.try_borrow_mut_lamports()? = received;
    }
    Ok(())
}
fn send<'info>(
    program: &Interface<'info, TokenInterface>,
    source: &InterfaceAccount<'info, TokenAccount>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    project: &Account<'info, Project>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    // A zero-return withdrawal needs no transfer.
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new_with_signer(
            program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: project.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init,payer=authority,space=8+Config::INIT_SPACE,seeds=[b"config"],bump)]
    pub config: Account<'info, Config>,
    #[account(constraint=program.programdata_address()?==Some(program_data.key()) @ EscrowError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::SlopEscrow>,
    #[account(constraint=program_data.upgrade_authority_address==Some(authority.key()) @ EscrowError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(project_id:[u8;32],network:[u8;32],identity_authority:Pubkey,fee_recipient:Pubkey,binding_delay:i64,rotation_delay:i64,purpose:Purpose)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// One project per owner, project ID and purpose, so ordinary awards and private bounties
    /// never share a vault.
    #[account(init,payer=owner,space=8+Project::INIT_SPACE,seeds=[b"project",owner.key().as_ref(),&project_id,&[purpose as u8]],bump)]
    pub project: Box<Account<'info, Project>>,
    /// Classic SPL or the approved metadata-only Token-2022 subset.
    #[account(constraint=*mint.to_account_info().owner==token_program.key() @ EscrowError::WrongMint, constraint=admitted_mint(&mint.to_account_info())?)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init,payer=owner,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project,token::token_program=token_program,constraint=admitted_token_account(&vault.to_account_info())?)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Box<Account<'info, Config>>,
}
#[derive(Accounts)]
#[instruction(project_id:[u8;32],network:[u8;32],identity_authority:Pubkey,fee_recipient:Pubkey,binding_delay:i64,rotation_delay:i64,purpose:Purpose)]
pub struct InitializeNative<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init,payer=owner,space=8+Project::INIT_SPACE,seeds=[b"project",owner.key().as_ref(),&project_id,&[purpose as u8]],bump)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: a program-owned, rent-funded, empty vault initialized at the canonical PDA.
    #[account(init,payer=owner,space=0,seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Box<Account<'info, Config>>,
}
#[derive(Accounts)]
pub struct DepositNative<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut,constraint=project.mint==anchor_lang::system_program::ID @ EscrowError::WrongMint)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: canonical vault; handler validates owner, empty data and rent before transfer.
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    #[account(constraint=*mint.to_account_info().owner==token_program.key() @ EscrowError::WrongMint, constraint=admitted_mint(&mint.to_account_info())?)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,token::mint=mint,token::authority=depositor,token::token_program=token_program,constraint=admitted_token_account(&source.to_account_info())?)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project,token::token_program=token_program,constraint=admitted_token_account(&vault.to_account_info())?)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
#[derive(Accounts)]
#[instruction(award_id:[u8;32], source_digest:[u8;32])]
pub struct Commit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: seeds bind the vault; vault_amount checks its asset, authority, owner and rent.
    #[account(seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(init,payer=owner,space=8+Origin::INIT_SPACE,seeds=[b"origin",project.key().as_ref(),&source_digest],bump)]
    pub origin: Account<'info, Origin>,
    #[account(init,payer=owner,space=8+Obligation::INIT_SPACE,seeds=[b"award",project.key().as_ref(),&award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetMonthlyCommitment<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
}
#[derive(Accounts)]
#[instruction(period:u32)]
pub struct CommitMonthly<'info> {
    /// Anyone; pays the period account's rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: seeds bind the vault; vault_amount checks its asset, authority, owner and rent.
    #[account(seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    /// One per project and period, so a period commits once.
    #[account(init,payer=payer,space=8+MonthlyAllocation::INIT_SPACE,seeds=[b"month",project.key().as_ref(),&period.to_le_bytes()],bump)]
    pub month: Box<Account<'info, MonthlyAllocation>>,
    /// CHECK: the instructions sysvar, read for the Ed25519 signature check.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(period:u32, award_id:[u8;32], source_digest:[u8;32])]
pub struct CommitMonthlyAward<'info> {
    /// Anyone; pays the award accounts' rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: seeds bind the vault; vault_amount checks its asset, authority, owner and rent.
    #[account(seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut,has_one=project,seeds=[b"month",project.key().as_ref(),&period.to_le_bytes()],bump)]
    pub month: Box<Account<'info, MonthlyAllocation>>,
    #[account(init,payer=payer,space=8+Origin::INIT_SPACE,seeds=[b"origin",project.key().as_ref(),&source_digest],bump)]
    pub origin: Account<'info, Origin>,
    #[account(init,payer=payer,space=8+Obligation::INIT_SPACE,seeds=[b"award",project.key().as_ref(),&award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    /// Exists once per source in a month, so a committed award cannot also be released.
    #[account(init,payer=payer,space=8+BindingVeto::INIT_SPACE,seeds=[b"settled",month.key().as_ref(),&source_digest],bump)]
    pub settled: Account<'info, BindingVeto>,
    /// Records that a monthly award consumed this source, so the same source in another
    /// month can be released.
    #[account(init,payer=payer,space=8+BindingVeto::INIT_SPACE,seeds=[b"monthly-source",project.key().as_ref(),&source_digest],bump)]
    pub monthly_source: Account<'info, BindingVeto>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(period:u32, source_digest:[u8;32])]
pub struct ReleaseMonthlyAward<'info> {
    /// Anyone; pays the settlement marker's rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,has_one=project,seeds=[b"month",project.key().as_ref(),&period.to_le_bytes()],bump)]
    pub month: Box<Account<'info, MonthlyAllocation>>,
    /// CHECK: the source's origin address; the handler requires an initialized origin unless the actor is zero.
    #[account(seeds=[b"origin",project.key().as_ref(),&source_digest],bump)]
    pub origin: UncheckedAccount<'info>,
    /// CHECK: the monthly-source marker address. The release rule no longer reads it (the
    /// recorded obligation decides); it stays so the instruction's accounts are unchanged.
    #[account(seeds=[b"monthly-source",project.key().as_ref(),&source_digest],bump)]
    pub monthly_source: UncheckedAccount<'info>,
    /// The obligation the origin records; required unless the actor is zero.
    pub obligation: Option<Box<Account<'info, Obligation>>>,
    /// The same marker as commit_monthly_award, so a source settles once per month.
    #[account(init,payer=payer,space=8+BindingVeto::INIT_SPACE,seeds=[b"settled",month.key().as_ref(),&source_digest],bump)]
    pub settled: Account<'info, BindingVeto>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(period:u32)]
pub struct ReleaseMonthlyReserve<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,has_one=project,seeds=[b"month",project.key().as_ref(),&period.to_le_bytes()],bump)]
    pub month: Box<Account<'info, MonthlyAllocation>>,
    /// CHECK: the instructions sysvar, read for the Ed25519 signature check.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}
#[derive(Accounts)]
#[instruction(actor_id:u64,network:[u8;32])]
pub struct BindWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub identity_authority: Signer<'info>,
    /// The wallet being bound; its signature is the contributor's acceptance of this exact binding.
    pub destination: Signer<'info>,
    #[account(has_one=identity_authority)]
    pub project: Box<Account<'info, Project>>,
    #[account(init_if_needed,payer=payer,space=8+WalletBinding::INIT_SPACE,seeds=[b"wallet",project.key().as_ref(),&actor_id.to_le_bytes()],bump)]
    pub binding: Box<Account<'info, WalletBinding>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(actor_id:u64,version:u64)]
pub struct VetoBinding<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one=owner)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,seeds=[b"wallet",project.key().as_ref(),&actor_id.to_le_bytes()],bump)]
    pub binding: Box<Account<'info, WalletBinding>>,
    #[account(init,payer=owner,space=8+BindingVeto::INIT_SPACE,seeds=[b"veto",project.key().as_ref(),&actor_id.to_le_bytes(),&version.to_le_bytes()],bump)]
    pub veto: Account<'info, BindingVeto>,
    /// An unpaid award to this actor in this project whose commit delay has not passed;
    /// it extends the veto window to that award's commit delay.
    #[account(constraint=obligation.project==project.key() @ EscrowError::InvalidAward,constraint=obligation.actor_id==actor_id @ EscrowError::InvalidAward,constraint=!obligation.paid @ EscrowError::AlreadyPaid)]
    pub obligation: Option<Box<Account<'info, Obligation>>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,has_one=project,seeds=[b"award",project.key().as_ref(),&obligation.award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    #[account(mut,seeds=[b"wallet",project.key().as_ref(),&obligation.actor_id.to_le_bytes()],bump,constraint=binding.actor_id==obligation.actor_id,constraint=binding.network==project.network)]
    pub binding: Box<Account<'info, WalletBinding>>,
    #[account(constraint=*mint.to_account_info().owner==token_program.key() @ EscrowError::WrongMint, constraint=admitted_mint(&mint.to_account_info())?)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project,token::token_program=token_program,constraint=admitted_token_account(&vault.to_account_info())?)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// The handler requires this to be the associated token account of whichever binding pays.
    #[account(mut,token::mint=mint,constraint=destination.key()!=vault.key(),token::token_program=token_program,constraint=admitted_token_account(&destination.to_account_info())?)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: must be the empty veto address for this project, actor and latest binding version.
    #[account(seeds=[b"veto",project.key().as_ref(),&obligation.actor_id.to_le_bytes(),&binding.version.to_le_bytes()],bump)]
    pub veto: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct PayNative<'info> {
    #[account(mut,constraint=project.mint==anchor_lang::system_program::ID @ EscrowError::WrongMint)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,has_one=project,seeds=[b"award",project.key().as_ref(),&obligation.award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    #[account(mut,seeds=[b"wallet",project.key().as_ref(),&obligation.actor_id.to_le_bytes()],bump,constraint=binding.actor_id==obligation.actor_id,constraint=binding.network==project.network)]
    pub binding: Box<Account<'info, WalletBinding>>,
    /// CHECK: canonical native vault; send_native checks its owner and permanent rent reserve.
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: must equal the latest co-signed binding; receives SOL directly, with no ATA.
    #[account(mut,address=binding.destination)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: empty veto PDA for this exact project, actor and binding version.
    #[account(seeds=[b"veto",project.key().as_ref(),&obligation.actor_id.to_le_bytes(),&binding.version.to_le_bytes()],bump)]
    pub veto: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct WithdrawNative<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,constraint=project.mint==anchor_lang::system_program::ID @ EscrowError::WrongMint)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: canonical native vault; send_native checks owner and rent.
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: refund is only to the immutable project owner.
    #[account(mut,address=project.owner)]
    pub destination: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct ClaimFeesNative<'info> {
    #[account(mut,constraint=project.mint==anchor_lang::system_program::ID @ EscrowError::WrongMint)]
    pub project: Box<Account<'info, Project>>,
    /// CHECK: canonical native vault; send_native checks owner and rent.
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: fees only go to the immutable Config-pinned project fee recipient.
    #[account(mut,address=project.fee_recipient)]
    pub fee_account: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct ProposeAuthorityRotation<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
}
#[derive(Accounts)]
pub struct ConfirmAuthorityRotation<'info> {
    pub rotation_authority: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=rotation_authority)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub project: Box<Account<'info, Project>>,
}
#[derive(Accounts)]
pub struct CancelAuthorityRotation<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
}
#[derive(Accounts)]
pub struct ExecuteAuthorityRotation<'info> {
    #[account(mut)]
    pub project: Box<Account<'info, Project>>,
}
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    #[account(constraint=*mint.to_account_info().owner==token_program.key() @ EscrowError::WrongMint, constraint=admitted_mint(&mint.to_account_info())?)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project,token::token_program=token_program,constraint=admitted_token_account(&vault.to_account_info())?)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut,token::mint=mint,token::authority=owner,constraint=destination.key()!=vault.key(),token::token_program=token_program,constraint=admitted_token_account(&destination.to_account_info())?)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
#[derive(Accounts)]
pub struct MigrateProject<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the handler requires a program-owned Project of the 316-byte layout.
    #[account(mut)]
    pub project: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    #[account(constraint=*mint.to_account_info().owner==token_program.key() @ EscrowError::WrongMint, constraint=admitted_mint(&mint.to_account_info())?)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project,token::token_program=token_program,constraint=admitted_token_account(&vault.to_account_info())?)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// Any token account of the mint that the fee recipient owns.
    #[account(mut,token::mint=mint,constraint=fee_account.owner==project.fee_recipient,constraint=fee_account.key()!=vault.key(),token::token_program=token_program,constraint=admitted_token_account(&fee_account.to_account_info())?)]
    pub fee_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
#[account]
#[derive(InitSpace)]
pub struct Project {
    pub owner: Pubkey,
    pub project_id: [u8; 32],
    pub network: [u8; 32],
    pub identity_authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub mint: Pubkey,
    pub reserved: u64,
    pub deposited: u64,
    pub paid: u64,
    pub payout_fees: u64,
    pub withdrawn_gross: u64,
    pub withdrawal_fees: u64,
    pub bump: u8,
    pub binding_delay: i64,
    pub pending_identity_authority: Pubkey,
    pub rotation_effective_at: i64,
    pub rotation_confirmed: bool,
    pub rotation_delay: i64,
    pub purpose: Purpose,
    /// The most a period's monthly awards may commit in gross, and whether anyone may record
    /// and commit them. Only the owner sets them.
    pub monthly_cap: u64,
    pub monthly_enabled: bool,
    /// Payout and withdrawal fees held in the vault until claim_fees moves them.
    pub accrued_fees: u64,
    /// Gross of admitted monthly allocations not yet committed or released. While it is
    /// positive the owner cannot commit by hand.
    pub monthly_outstanding: u64,
}
/// What a project holds funds for. It is part of the project PDA seeds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Purpose {
    Ordinary,
    Bounty,
}
/// One period's recorded allocation root and the gross committed from it so far.
#[account]
#[derive(InitSpace)]
pub struct MonthlyAllocation {
    pub project: Pubkey,
    pub period: u32,
    pub allocation_root: [u8; 32],
    /// Gross settled so far: committed awards plus released awards.
    pub committed: u64,
    pub total: u64,
    /// The part of `committed` that release_monthly_award or release_monthly_reserve returned
    /// to free balance. This
    /// field also makes the account larger than the 92-byte month of the 316-byte build (no
    /// settled markers or outstanding count), so such a month fails closed here.
    pub released: u64,
    /// When the attester froze the allocation. Only a source consumed by hand before it can
    /// be released.
    pub frozen_at: i64,
    /// Legacy layout field. New funded months never expire.
    pub expired: bool,
}
/// The separate identity, fee and rotation authorities, written once by
/// `initialize_config` and never changed.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub identity_authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub rotation_authority: Pubkey,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Obligation {
    pub gross: u64,
    pub source_digest: [u8; 32],
    pub project: Pubkey,
    pub award_id: [u8; 32],
    pub actor_id: u64,
    pub principal: u64,
    pub fee: u64,
    pub paid: bool,
    pub committed_at: i64,
}
/// One binding per project and actor, so each project's delay, vetoes and payments are
/// its own. The first seven fields are the latest binding, the only one that can pay.
#[account]
#[derive(InitSpace)]
pub struct WalletBinding {
    pub claim_digest: [u8; 32],
    pub authority: Pubkey,
    pub actor_id: u64,
    pub network: [u8; 32],
    pub destination: Pubkey,
    pub version: u64,
    pub bound_at: i64,
    /// The version the last payment in this project used; 0 before the first payment.
    pub paid_version: u64,
    /// Vetoes recorded since the last payment in this project.
    pub veto_count: u8,
}
#[account]
#[derive(InitSpace)]
pub struct BindingVeto {}
#[event]
pub struct MonthlyCommitmentSet {
    pub project: Pubkey,
    pub cap: u64,
    pub enabled: bool,
}
#[event]
pub struct MonthlyCommitted {
    pub project: Pubkey,
    pub period: u32,
    pub allocation_root: [u8; 32],
    pub total: u64,
}
#[event]
pub struct AuthorityRotationProposed {
    pub project: Pubkey,
    pub current: Pubkey,
    pub proposed: Pubkey,
    pub effective_at: i64,
}
#[event]
pub struct AuthorityRotationConfirmed {
    pub project: Pubkey,
    pub proposed: Pubkey,
}
#[event]
pub struct AuthorityRotationCancelled {
    pub project: Pubkey,
    pub proposed: Pubkey,
}
#[event]
pub struct AuthorityRotated {
    pub project: Pubkey,
    pub previous: Pubkey,
    pub current: Pubkey,
}
#[event]
pub struct BindingVetoed {
    pub project: Pubkey,
    pub actor_id: u64,
    pub version: u64,
}
#[event]
pub struct AwardCommitted {
    pub gross: u64,
    pub source_digest: [u8; 32],
    pub project: Pubkey,
    pub award_id: [u8; 32],
    pub actor_id: u64,
    pub principal: u64,
    pub fee: u64,
}
#[event]
pub struct WalletBound {
    pub actor_id: u64,
    pub network: [u8; 32],
    pub destination: Pubkey,
    pub version: u64,
    pub bound_at: i64,
}
#[event]
pub struct AwardPaid {
    pub gross: u64,
    pub project: Pubkey,
    pub award_id: [u8; 32],
    pub principal: u64,
    pub fee: u64,
    pub destination: Pubkey,
    pub wallet_version: u64,
}
#[event]
pub struct MonthlyAwardReleased {
    pub project: Pubkey,
    pub period: u32,
    pub source_digest: [u8; 32],
    pub actor_id: u64,
    pub gross: u64,
}
#[event]
pub struct MonthlyReserveReleased {
    pub project: Pubkey,
    pub period: u32,
    pub unsettled: u64,
    pub released: u64,
}
#[event]
pub struct ProjectMigrated {
    pub project: Pubkey,
}
#[event]
pub struct FeesClaimed {
    pub project: Pubkey,
    pub fee_account: Pubkey,
    pub amount: u64,
}
#[event]
pub struct UnusedWithdrawn {
    pub project: Pubkey,
    pub gross: u64,
    pub fee: u64,
    pub returned: u64,
}
#[event]
pub struct Deposited {
    pub project: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
}
#[event]
pub struct ConfigInitialized {
    pub identity_authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub rotation_authority: Pubkey,
}
#[error_code]
pub enum EscrowError {
    #[msg("Invalid actor or destination")]
    InvalidIdentity,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Arithmetic,
    #[msg("Withdrawal or award would consume reserved funds")]
    InsufficientFreeBalance,
    #[msg("Obligation already paid")]
    AlreadyPaid,
    #[msg("Wallet predecessor version is stale")]
    StaleBinding,
    #[msg("Network domain does not match project")]
    WrongNetwork,
    #[msg("Mint or token program is not supported")]
    WrongMint,
    #[msg("Award ID is not bound to this project and source")]
    InvalidAward,
    #[msg("Wallet binding is still in its activation delay")]
    BindingPending,
    #[msg("Project owner vetoed this wallet binding")]
    BindingVetoed,
    #[msg("Wallet binding has paid or its veto window has closed")]
    BindingActive,
    #[msg("Destination must be the bound wallet's associated token account")]
    WrongDestination,
    #[msg("Award is still inside its commit delay")]
    AwardPending,
    #[msg("Owner veto limit reached since the actor's last payment")]
    VetoLimit,
    #[msg("Binding delay must be 0 to 30 days; rotation delay 0 to 90 days")]
    InvalidDelay,
    #[msg("Binding submission expired")]
    BindingExpired,
    #[msg("An identity authority rotation is already proposed")]
    RotationPending,
    #[msg("No identity authority rotation is proposed")]
    NoRotationPending,
    #[msg("The rotation authority already confirmed this rotation")]
    RotationConfirmed,
    #[msg("The rotation authority has not confirmed this rotation")]
    RotationUnconfirmed,
    #[msg("The rotation delay has not passed")]
    RotationNotReady,
    #[msg("Identity authority or fee recipient differs from the pinned Config")]
    ConfigMismatch,
    #[msg("Only the program upgrade authority can initialize the Config")]
    NotUpgradeAuthority,
    #[msg("This instruction does not apply to the project's purpose")]
    WrongPurpose,
    #[msg("The owner has turned monthly commitments off")]
    MonthlyDisabled,
    #[msg("Period must be YYYYMM with year 2000 to 9999")]
    InvalidPeriod,
    #[msg("The period's monthly window is not open")]
    MonthlyWindowClosed,
    #[msg("The identity authority did not sign this allocation")]
    InvalidAttestation,
    #[msg("Award is not in the recorded allocation")]
    InvalidAllocationProof,
    #[msg("Monthly awards would exceed the owner's monthly cap")]
    MonthlyCapExceeded,
    #[msg("An admitted monthly allocation still has uncommitted awards")]
    MonthlyOutstanding,
    #[msg("This monthly award can still be committed")]
    AwardCommittable,
    #[msg("Account is not a Project of the 316-byte layout")]
    NotLegacyProject,
    #[msg("The month has already expired")]
    MonthExpired,
    #[msg("The allocation freeze time must be inside the window and not in the future")]
    InvalidFreeze,
    #[msg("The month's unsettled gross changed after the release was signed")]
    MonthlyReserveChanged,
    #[msg("Token extension or authority is outside the approved metadata-only policy")]
    UnsupportedTokenExtension,
}

#[account]
#[derive(InitSpace)]
pub struct Origin {
    pub obligation: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;
    // The deployable build supports immediate payment and rotation.
    #[cfg(not(feature = "short-delay-for-tests"))]
    #[test]
    fn production_delay_bounds() {
        assert!(valid_delay(0));
        assert!(valid_delay(3599));
        assert!(valid_delay(3600));
        assert!(valid_delay(30 * 86400));
        assert!(!valid_delay(30 * 86400 + 1));
        assert!(valid_rotation_delay(0));
        assert!(valid_rotation_delay(3599));
        assert!(valid_rotation_delay(3600));
        assert!(valid_rotation_delay(90 * 86400));
        assert!(!valid_rotation_delay(90 * 86400 + 1));
    }
    #[test]
    fn monthly_window_is_the_utc_month_plus_72_hours() {
        // November 2026 opens at 00:00 UTC on 4 December 2026 and closes on 4 January 2027.
        assert_eq!(
            monthly_window(202611).unwrap(),
            (1_796_342_400, 1_799_020_800)
        );
        assert_eq!(monthly_window(202612).unwrap().0, 1_799_020_800);
        // February 2028 has 29 days.
        assert_eq!(monthly_window(202802).unwrap().0, 1_835_740_800);
        for invalid in [202600, 202613, 199912, 1_000_001] {
            assert!(monthly_window(invalid).is_err());
        }
    }
    #[test]
    fn merkle_proofs_match_the_documented_tree() {
        let leaves: Vec<AllocationNode> = (1..=3u64)
            .map(|i| AllocationNode {
                hash: monthly_leaf(i, i * 10, &[i as u8; 32]),
                total: i * 10,
            })
            .collect();
        let node = |l: &AllocationNode, r: &AllocationNode| sum_node(*l, *r).unwrap();
        let left = node(&leaves[0], &leaves[1]);
        let root = node(&left, &leaves[2]);
        assert_eq!(
            merkle_sum_root(leaves[0], 0, 3, &[leaves[1], leaves[2]]).unwrap(),
            root
        );
        assert_eq!(
            merkle_sum_root(leaves[1], 1, 3, &[leaves[0], leaves[2]]).unwrap(),
            root
        );
        // The odd last leaf moves up and needs only the left subtree.
        assert_eq!(merkle_sum_root(leaves[2], 2, 3, &[left]).unwrap(), root);
        // A wrong index and extra or missing proof elements fail.
        assert_ne!(
            merkle_sum_root(leaves[0], 1, 3, &[leaves[1], leaves[2]]).unwrap(),
            root
        );
        assert!(merkle_sum_root(leaves[2], 2, 3, &[left, left]).is_err());
        assert!(merkle_sum_root(leaves[0], 0, 3, &[leaves[1]]).is_err());
        assert!(merkle_sum_root(leaves[0], 3, 3, &[]).is_err());
        assert_eq!(merkle_sum_root(leaves[0], 0, 1, &[]).unwrap(), leaves[0]);
    }
    #[test]
    fn migration_appends_two_counters() {
        assert_eq!(8 + Project::INIT_SPACE, LEGACY_PROJECT_SIZE + 16);
        // A legacy 92-byte month cannot deserialize as the current month.
        assert_eq!(8 + MonthlyAllocation::INIT_SPACE, 109);
    }
    #[test]
    fn fee_is_two_percent_per_award_or_withdrawal() {
        // PRD section 18: 850 USDC gives a 17 USDC fee and 833 USDC refund.
        assert_eq!(fee_for(850_000_000), 17_000_000);
        assert_eq!(fee_for(1), 1);
        assert_eq!(fee_for(49), 1);
        assert_eq!(fee_for(50), 1);
        assert_eq!(fee_for(51), 2);
        assert_eq!(fee_for(99), 2);
        assert_eq!(fee_for(100), 2);
        assert_eq!(fee_for(u64::MAX), u64::MAX / 50 + 1);
    }
}
