//! Holds refundable submission deposits, one per payment for a named item (a pull request).
//!
//! Each deposit fixes, when it is made, the only two places its tokens can ever go: back to
//! the payer, or to the `kept_to` wallet the payer named. The resolver chooses between those
//! two and nothing else. If nobody resolves a deposit for `reclaim_delay`, the payer takes it
//! back without anyone's help.
//!
//! The program keeps no list of accepted mints, amounts or kept wallets: that check is off
//! chain, and a deposit that fails it is refunded by the resolver or reclaimed by its payer.
//! The owner replaces the resolver and pauses new deposits; no owner or resolver action can
//! send a deposit anywhere but its payer or its `kept_to`, and pausing never blocks `resolve`
//! or `reclaim`. The resolver is never the owner or the pending owner.
//!
//! Only mints of the classic SPL Token program are admitted, so every transfer moves exactly
//! its amount; Token-2022 mints, with their transfer fees and hooks, are refused. Tokens sent
//! to a vault without `deposit` belong to no deposit and cannot be moved by anyone. A
//! `Deposit` account exists exactly while its deposit is open: it is closed in the instruction
//! that pays the deposit out, and its rent returns to the payer.
//!
//! This is the Solana counterpart of `contracts/evm/src/SubmissionDeposits.sol`. It is a
//! separate program from `slop-escrow` and shares no state with it.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

// A local placeholder. The owner generates the program address before the verifiable build
// (docs/submission-deposits-solana-deploy-runbook.md); nobody holds a key for this one.
declare_id!("HgkeEAe63g7pDbvKsXXh8rSStM8Nw5z4eiYapVMKCt9t");

/// Longest reclaim delay `initialize` accepts, so a payer is never stranded for longer.
pub const MAX_RECLAIM_DELAY: i64 = 365 * 86_400;

#[program]
pub mod slop_submission_deposits {
    use super::*;

    /// Writes the owner, the resolver and the reclaim delay once. Only the program's upgrade
    /// authority can sign it, so nobody else can initialize first, and it must run before the
    /// upgrade authority is removed. No instruction changes the delay or closes the Config.
    pub fn initialize(
        ctx: Context<Initialize>,
        owner: Pubkey,
        resolver: Pubkey,
        reclaim_delay: i64,
    ) -> Result<()> {
        require!(
            owner != Pubkey::default()
                && resolver != Pubkey::default()
                && owner != resolver
                && valid_reclaim_delay(reclaim_delay),
            DepositsError::InvalidInput
        );
        let config = &mut ctx.accounts.config;
        config.owner = owner;
        config.pending_owner = Pubkey::default();
        config.resolver = resolver;
        config.reclaim_delay = reclaim_delay;
        config.deposit_count = 0;
        config.deposits_paused = false;
        config.bump = ctx.bumps.config;
        emit!(Initialized {
            owner,
            resolver,
            reclaim_delay
        });
        Ok(())
    }

    /// Creates the ledger and the vault token account of one classic SPL mint. Anyone may
    /// call it and pays the rent of both accounts, which are never closed.
    pub fn open_vault(ctx: Context<OpenVault>) -> Result<()> {
        let ledger = &mut ctx.accounts.ledger;
        ledger.mint = ctx.accounts.mint.key();
        ledger.open_total = 0;
        ledger.bump = ctx.bumps.ledger;
        ledger.vault_bump = ctx.bumps.vault;
        emit!(VaultOpened {
            mint: ledger.mint,
            vault: ctx.accounts.vault.key()
        });
        Ok(())
    }

    /// Moves exactly `amount` from the payer's token account into the vault and records it
    /// against `item` as deposit number `deposit_count + 1`. The payer and `kept_to` are fixed
    /// here and never change. Refused while deposits are paused, for a zero amount, and for a
    /// zero `kept_to` or one of this program's own accounts as `kept_to`.
    pub fn deposit(
        ctx: Context<MakeDeposit>,
        item: [u8; 32],
        amount: u64,
        kept_to: Pubkey,
    ) -> Result<()> {
        require!(
            !ctx.accounts.config.deposits_paused,
            DepositsError::DepositsArePaused
        );
        require!(
            amount > 0
                && kept_to != Pubkey::default()
                && kept_to != ctx.accounts.config.key()
                && kept_to != ctx.accounts.ledger.key()
                && kept_to != ctx.accounts.vault.key(),
            DepositsError::InvalidInput
        );
        let before = ctx.accounts.vault.amount;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.vault.amount == add(before, amount)?,
            DepositsError::TransferNotExact
        );
        let id = add(ctx.accounts.config.deposit_count, 1)?;
        ctx.accounts.config.deposit_count = id;
        let ledger = &mut ctx.accounts.ledger;
        ledger.open_total = add(ledger.open_total, amount)?;
        require!(
            ctx.accounts.vault.amount >= ledger.open_total,
            DepositsError::VaultShort
        );
        let deposit = &mut ctx.accounts.deposit;
        deposit.id = id;
        deposit.payer = ctx.accounts.payer.key();
        deposit.mint = ctx.accounts.mint.key();
        deposit.kept_to = kept_to;
        deposit.item = item;
        deposit.amount = amount;
        deposit.deposited_at = Clock::get()?.unix_timestamp;
        deposit.bump = ctx.bumps.deposit;
        emit!(Deposited {
            id,
            item,
            payer: deposit.payer,
            mint: deposit.mint,
            amount,
            kept_to
        });
        Ok(())
    }

    /// Settles one open deposit, once: `refund` sends its amount to the payer's associated
    /// token account, otherwise to the associated token account of its `kept_to`. The resolver
    /// has no other choice of destination. The Deposit account is closed and its rent returns
    /// to the payer. Works while deposits are paused.
    pub fn resolve(ctx: Context<Resolve>, refund: bool) -> Result<()> {
        let deposit = &ctx.accounts.deposit;
        let wallet = if refund {
            deposit.payer
        } else {
            deposit.kept_to
        };
        require_keys_eq!(
            ctx.accounts.destination.owner,
            wallet,
            DepositsError::WrongDestination
        );
        require_keys_eq!(
            ctx.accounts.destination.key(),
            get_associated_token_address_with_program_id(
                &wallet,
                &deposit.mint,
                &ctx.accounts.token_program.key()
            ),
            DepositsError::WrongDestination
        );
        let id = deposit.id;
        let amount = deposit.amount;
        pay_out(
            &ctx.accounts.token_program,
            &mut ctx.accounts.ledger,
            &ctx.accounts.mint,
            &mut ctx.accounts.vault,
            &ctx.accounts.destination,
            amount,
        )?;
        emit!(Resolved {
            id,
            refunded: refund
        });
        Ok(())
    }

    /// Returns an open deposit to its payer once `reclaim_delay` has passed since the deposit.
    /// Only the payer may call it, and the tokens go to a token account the payer owns. It
    /// works while deposits are paused and whoever the resolver is.
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        let deposit = &ctx.accounts.deposit;
        let earliest = reclaimable_at(deposit.deposited_at, ctx.accounts.config.reclaim_delay)?;
        require!(
            Clock::get()?.unix_timestamp >= earliest,
            DepositsError::ReclaimTooEarly
        );
        let id = deposit.id;
        let amount = deposit.amount;
        pay_out(
            &ctx.accounts.token_program,
            &mut ctx.accounts.ledger,
            &ctx.accounts.mint,
            &mut ctx.accounts.vault,
            &ctx.accounts.destination,
            amount,
        )?;
        emit!(Reclaimed { id });
        Ok(())
    }

    /// Replaces the resolver. The owner and the pending owner may not become the resolver, so
    /// one key never holds both roles.
    pub fn set_resolver(ctx: Context<OwnerAction>, next: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            next != Pubkey::default()
                && next != config.owner
                && next != config.pending_owner
                && next != config.resolver,
            DepositsError::InvalidInput
        );
        emit!(ResolverChanged {
            previous: config.resolver,
            next
        });
        config.resolver = next;
        Ok(())
    }

    /// Stops or resumes new deposits. It never blocks `resolve` or `reclaim`.
    pub fn pause_deposits(ctx: Context<OwnerAction>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            paused != config.deposits_paused,
            DepositsError::InvalidInput
        );
        config.deposits_paused = paused;
        emit!(DepositsPaused { paused });
        Ok(())
    }

    /// Names a pending owner, who takes over with `accept_ownership`. The all-zero address
    /// cancels a pending handover. The resolver may not be named.
    pub fn transfer_ownership(ctx: Context<OwnerAction>, new_owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(new_owner != config.resolver, DepositsError::InvalidInput);
        config.pending_owner = new_owner;
        emit!(OwnershipTransferStarted {
            owner: config.owner,
            pending_owner: new_owner
        });
        Ok(())
    }

    pub fn accept_ownership(ctx: Context<AcceptOwnership>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        // A cancelled handover leaves the all-zero address, which nobody may accept.
        require!(
            config.pending_owner != Pubkey::default()
                && ctx.accounts.pending_owner.key() == config.pending_owner,
            DepositsError::NotPendingOwner
        );
        emit!(OwnershipTransferred {
            previous: config.owner,
            owner: config.pending_owner
        });
        config.owner = config.pending_owner;
        config.pending_owner = Pubkey::default();
        Ok(())
    }
}

pub fn valid_reclaim_delay(delay: i64) -> bool {
    delay > 0 && delay <= MAX_RECLAIM_DELAY
}

/// The first second at which the payer of a deposit made at `deposited_at` may reclaim it.
pub fn reclaimable_at(deposited_at: i64, reclaim_delay: i64) -> Result<i64> {
    deposited_at
        .checked_add(reclaim_delay)
        .ok_or_else(|| error!(DepositsError::Arithmetic))
}

fn add(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| error!(DepositsError::Arithmetic))
}

/// Sends `amount` from the mint's vault to `destination`, signed by the mint's ledger, and
/// requires the vault to still cover every open deposit afterwards. The caller has already
/// bound `destination` to the deposit's payer or kept wallet.
fn pay_out<'info>(
    token_program: &Program<'info, Token>,
    ledger: &mut Account<'info, Ledger>,
    mint: &Account<'info, Mint>,
    vault: &mut Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    require_keys_neq!(
        destination.key(),
        vault.key(),
        DepositsError::WrongDestination
    );
    ledger.open_total = ledger
        .open_total
        .checked_sub(amount)
        .ok_or_else(|| error!(DepositsError::Arithmetic))?;
    let mint_key = mint.key();
    let seeds: &[&[u8]] = &[b"ledger", mint_key.as_ref(), &[ledger.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: ledger.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )?;
    vault.reload()?;
    require!(vault.amount >= ledger.open_total, DepositsError::VaultShort);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init,payer=authority,space=8+Config::INIT_SPACE,seeds=[b"config"],bump)]
    pub config: Account<'info, Config>,
    #[account(constraint=program.programdata_address()?==Some(program_data.key()) @ DepositsError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::SlopSubmissionDeposits>,
    #[account(constraint=program_data.upgrade_authority_address==Some(authority.key()) @ DepositsError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    /// A mint of the classic SPL Token program; any other owner is refused.
    pub mint: Box<Account<'info, Mint>>,
    #[account(init,payer=funder,space=8+Ledger::INIT_SPACE,seeds=[b"ledger",mint.key().as_ref()],bump)]
    pub ledger: Box<Account<'info, Ledger>>,
    #[account(init,payer=funder,seeds=[b"vault",mint.key().as_ref()],bump,token::mint=mint,token::authority=ledger,token::token_program=token_program)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakeDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,has_one=mint,seeds=[b"ledger",mint.key().as_ref()],bump=ledger.bump)]
    pub ledger: Box<Account<'info, Ledger>>,
    pub mint: Box<Account<'info, Mint>>,
    /// Any token account of the mint that the payer owns.
    #[account(mut,token::mint=mint,token::authority=payer)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(mut,seeds=[b"vault",mint.key().as_ref()],bump=ledger.vault_bump,token::mint=mint,token::authority=ledger)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// The next id is part of the address, so an id is used once and ids have no gap.
    #[account(init,payer=payer,space=8+Deposit::INIT_SPACE,seeds=[b"deposit".as_ref(),config.deposit_count.wrapping_add(1).to_le_bytes().as_ref()],bump)]
    pub deposit: Box<Account<'info, Deposit>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump,has_one=resolver @ DepositsError::NotResolver)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,close=payer,has_one=mint,has_one=payer,seeds=[b"deposit".as_ref(),deposit.id.to_le_bytes().as_ref()],bump=deposit.bump)]
    pub deposit: Box<Account<'info, Deposit>>,
    #[account(mut,has_one=mint,seeds=[b"ledger",mint.key().as_ref()],bump=ledger.bump)]
    pub ledger: Box<Account<'info, Ledger>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut,seeds=[b"vault",mint.key().as_ref()],bump=ledger.vault_bump,token::mint=mint,token::authority=ledger)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// The handler requires the associated token account of the payer (refund) or of the
    /// kept wallet (kept), still owned by that wallet.
    #[account(mut,token::mint=mint)]
    pub destination: Box<Account<'info, TokenAccount>>,
    /// CHECK: receives only the closed Deposit account's rent; `has_one` on the deposit
    /// fixes it to the recorded payer.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[b"config"],bump=config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,close=payer,has_one=mint,has_one=payer @ DepositsError::NotPayer,seeds=[b"deposit".as_ref(),deposit.id.to_le_bytes().as_ref()],bump=deposit.bump)]
    pub deposit: Box<Account<'info, Deposit>>,
    #[account(mut,has_one=mint,seeds=[b"ledger",mint.key().as_ref()],bump=ledger.bump)]
    pub ledger: Box<Account<'info, Ledger>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut,seeds=[b"vault",mint.key().as_ref()],bump=ledger.vault_bump,token::mint=mint,token::authority=ledger)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// Any token account of the mint that the payer owns.
    #[account(mut,token::mint=mint,token::authority=payer)]
    pub destination: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    pub owner: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump,has_one=owner @ DepositsError::NotOwner)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptOwnership<'info> {
    pub pending_owner: Signer<'info>,
    #[account(mut,seeds=[b"config"],bump=config.bump)]
    pub config: Account<'info, Config>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    /// All zero when no handover is pending.
    pub pending_owner: Pubkey,
    pub resolver: Pubkey,
    /// Seconds a payer waits before reclaiming an unresolved deposit. Set once.
    pub reclaim_delay: i64,
    /// Deposits ever made. Ids count up from 1, so this is also the latest id.
    pub deposit_count: u64,
    pub deposits_paused: bool,
    pub bump: u8,
}

/// One per mint. It is the token authority of that mint's vault.
#[account]
#[derive(InitSpace)]
pub struct Ledger {
    pub mint: Pubkey,
    /// Sum of the mint's open deposits, in base units.
    pub open_total: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Exists exactly while the deposit is open.
#[account]
#[derive(InitSpace)]
pub struct Deposit {
    pub id: u64,
    /// The wallet that paid. Refunds and reclaims go to token accounts it owns.
    pub payer: Pubkey,
    pub mint: Pubkey,
    /// The wallet whose associated token account receives a kept deposit.
    pub kept_to: Pubkey,
    pub item: [u8; 32],
    pub amount: u64,
    pub deposited_at: i64,
    pub bump: u8,
}

#[event]
pub struct Initialized {
    pub owner: Pubkey,
    pub resolver: Pubkey,
    pub reclaim_delay: i64,
}
#[event]
pub struct VaultOpened {
    pub mint: Pubkey,
    pub vault: Pubkey,
}
#[event]
pub struct Deposited {
    pub id: u64,
    pub item: [u8; 32],
    pub payer: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub kept_to: Pubkey,
}
#[event]
pub struct Resolved {
    pub id: u64,
    pub refunded: bool,
}
#[event]
pub struct Reclaimed {
    pub id: u64,
}
#[event]
pub struct ResolverChanged {
    pub previous: Pubkey,
    pub next: Pubkey,
}
#[event]
pub struct DepositsPaused {
    pub paused: bool,
}
#[event]
pub struct OwnershipTransferStarted {
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
}
#[event]
pub struct OwnershipTransferred {
    pub previous: Pubkey,
    pub owner: Pubkey,
}

#[error_code]
pub enum DepositsError {
    #[msg("Only the program's upgrade authority initializes it")]
    NotUpgradeAuthority,
    #[msg("Only the owner may do this")]
    NotOwner,
    #[msg("Only the pending owner may accept ownership")]
    NotPendingOwner,
    #[msg("Only the resolver may resolve a deposit")]
    NotResolver,
    #[msg("Only the payer may reclaim a deposit")]
    NotPayer,
    #[msg("New deposits are paused")]
    DepositsArePaused,
    #[msg("Invalid input")]
    InvalidInput,
    #[msg("The reclaim delay has not passed")]
    ReclaimTooEarly,
    #[msg("The destination is not the token account this deposit may be paid to")]
    WrongDestination,
    #[msg("The vault did not receive exactly the amount")]
    TransferNotExact,
    #[msg("The vault would not cover the open deposits")]
    VaultShort,
    #[msg("Arithmetic overflow")]
    Arithmetic,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reclaim_delay_is_positive_and_at_most_a_year() {
        assert!(!valid_reclaim_delay(i64::MIN));
        assert!(!valid_reclaim_delay(-1));
        assert!(!valid_reclaim_delay(0));
        assert!(valid_reclaim_delay(1));
        assert!(valid_reclaim_delay(30 * 86_400));
        assert!(valid_reclaim_delay(MAX_RECLAIM_DELAY));
        assert!(!valid_reclaim_delay(MAX_RECLAIM_DELAY + 1));
        assert!(!valid_reclaim_delay(i64::MAX));
    }

    #[test]
    fn reclaim_opens_exactly_at_the_deposit_time_plus_the_delay() {
        assert_eq!(
            reclaimable_at(1_800_000_000, 2_592_000).unwrap(),
            1_802_592_000
        );
        assert!(reclaimable_at(i64::MAX, 1).is_err());
    }

    #[test]
    fn sums_refuse_overflow() {
        assert_eq!(add(1, 2).unwrap(), 3);
        assert!(add(u64::MAX, 1).is_err());
    }

    #[test]
    fn account_sizes_match_the_published_layout() {
        assert_eq!(8 + Config::INIT_SPACE, 122);
        assert_eq!(8 + Ledger::INIT_SPACE, 50);
        assert_eq!(8 + Deposit::INIT_SPACE, 161);
    }
}
