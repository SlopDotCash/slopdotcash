use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
declare_id!("5KFQm1jLFkcS1V5PFpUFg6omNHoDQZTaxqTwwEpnenSL");
#[program]
pub mod slop_escrow {
    use super::*;
    pub fn initialize(
        ctx: Context<Initialize>,
        project_id: [u8; 32],
        network: [u8; 32],
        identity_authority: Pubkey,
        fee_recipient: Pubkey,
        binding_delay: i64,
    ) -> Result<()> {
        require!(
            identity_authority != Pubkey::default()
                && fee_recipient != Pubkey::default()
                && identity_authority != ctx.accounts.owner.key()
                && binding_delay >= 0,
            EscrowError::InvalidIdentity
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
        Ok(())
    }
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            6,
        )?;
        ctx.accounts.project.deposited = add(ctx.accounts.project.deposited, amount)?;
        Ok(())
    }
    pub fn commit(
        ctx: Context<Commit>,
        award_id: [u8; 32],
        source_digest: [u8; 32],
        actor_id: u64,
        gross: u64,
    ) -> Result<()> {
        require!(gross > 0 && actor_id > 0, EscrowError::InvalidAmount);
        // Binding the project to the ID stops another project from claiming it first.
        require!(
            award_id == award_id_for(&ctx.accounts.project.key(), &source_digest),
            EscrowError::InvalidAward
        );
        let fee = gross / 50;
        let principal = gross - fee;
        let reserve = gross;
        let p = &mut ctx.accounts.project;
        require!(
            ctx.accounts.vault.amount >= add(p.reserved, reserve)? && free(p)? >= reserve,
            EscrowError::InsufficientFreeBalance
        );
        p.reserved = add(p.reserved, reserve)?;
        let a = &mut ctx.accounts.obligation;
        a.project = p.key();
        a.award_id = award_id;
        a.source_digest = source_digest;
        ctx.accounts.origin.obligation = a.key();
        a.actor_id = actor_id;
        a.gross = gross;
        a.principal = principal;
        a.fee = fee;
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
    // The attester signs this exact transaction, including deployment and predecessor.
    pub fn bind_wallet(
        ctx: Context<BindWallet>,
        actor_id: u64,
        network: [u8; 32],
        expected_version: u64,
        destination: Pubkey,
        claim_digest: [u8; 32],
    ) -> Result<()> {
        require!(
            actor_id > 0 && destination != Pubkey::default(),
            EscrowError::InvalidIdentity
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
    // The owner stops a pending binding for this project before it can pay. A new
    // authority binding (next version) is required afterwards.
    pub fn veto_binding(ctx: Context<VetoBinding>, actor_id: u64, version: u64) -> Result<()> {
        let b = &ctx.accounts.binding;
        require!(
            b.version == version && b.actor_id == actor_id && version > 0,
            EscrowError::StaleBinding
        );
        require!(
            Clock::get()?.unix_timestamp < activates_at(b, &ctx.accounts.project)?,
            EscrowError::BindingActive
        );
        emit!(BindingVetoed {
            project: ctx.accounts.project.key(),
            actor_id,
            version
        });
        Ok(())
    }
    pub fn pay(ctx: Context<Pay>, expected_version: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        let a = &ctx.accounts.obligation;
        require!(!a.paid, EscrowError::AlreadyPaid);
        require!(
            ctx.accounts.binding.version > 0 && ctx.accounts.binding.version == expected_version,
            EscrowError::StaleBinding
        );
        require!(
            Clock::get()?.unix_timestamp >= activates_at(&ctx.accounts.binding, p)?,
            EscrowError::BindingPending
        );
        // The veto address can only be created by veto_binding; an empty system
        // account proves the owner did not veto this binding version.
        require!(
            ctx.accounts.veto.data_is_empty()
                && ctx.accounts.veto.owner == &anchor_lang::system_program::ID,
            EscrowError::BindingVetoed
        );
        let seeds: &[&[u8]] = &[b"project", p.owner.as_ref(), &p.project_id, &[p.bump]];
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.mint,
            p,
            seeds,
            a.principal,
        )?;
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.fee_account,
            &ctx.accounts.mint,
            p,
            seeds,
            a.fee,
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
        ctx.accounts.obligation.paid = true;
        emit!(AwardPaid {
            project: p.key(),
            award_id: ctx.accounts.obligation.award_id,
            gross: ctx.accounts.obligation.gross,
            principal,
            fee,
            destination: ctx.accounts.binding.destination,
            wallet_version: expected_version
        });
        Ok(())
    }
    pub fn withdraw(ctx: Context<Withdraw>, gross: u64) -> Result<()> {
        let p = &ctx.accounts.project;
        require!(
            gross > 0 && ctx.accounts.vault.amount >= add(p.reserved, gross)? && free(p)? >= gross,
            EscrowError::InsufficientFreeBalance
        );
        let cumulative = add(p.withdrawn_gross, gross)?;
        let fee = (cumulative / 10)
            .checked_sub(p.withdrawal_fees)
            .ok_or(EscrowError::Arithmetic)?;
        let returned = gross.checked_sub(fee).ok_or(EscrowError::Arithmetic)?;
        let seeds: &[&[u8]] = &[b"project", p.owner.as_ref(), &p.project_id, &[p.bump]];
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.mint,
            p,
            seeds,
            returned,
        )?;
        send(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.fee_account,
            &ctx.accounts.mint,
            p,
            seeds,
            fee,
        )?;
        let p = &mut ctx.accounts.project;
        p.withdrawn_gross = cumulative;
        p.withdrawal_fees = add(p.withdrawal_fees, fee)?;
        emit!(UnusedWithdrawn {
            project: p.key(),
            gross,
            fee,
            returned
        });
        Ok(())
    }
}
/// The only valid award ID for a source in this project.
pub fn award_id_for(project: &Pubkey, source_digest: &[u8; 32]) -> [u8; 32] {
    hashv(&[b"slop-escrow-award", project.as_ref(), source_digest]).to_bytes()
}
fn activates_at(b: &WalletBinding, p: &Project) -> Result<i64> {
    b.bound_at
        .checked_add(p.binding_delay)
        .ok_or(error!(EscrowError::Arithmetic))
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
fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(error!(EscrowError::Arithmetic))
}
fn send<'info>(
    program: &Program<'info, Token>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    project: &Account<'info, Project>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
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
        6,
    )
}
#[derive(Accounts)]
#[instruction(project_id:[u8;32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init,payer=owner,space=8+Project::INIT_SPACE,seeds=[b"project",owner.key().as_ref(),&project_id],bump)]
    pub project: Box<Account<'info, Project>>,
    #[account(constraint=mint.decimals==6 @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(init,payer=owner,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    pub mint: Account<'info, Mint>,
    #[account(mut,token::mint=mint,token::authority=owner)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
#[instruction(award_id:[u8;32], source_digest:[u8;32])]
pub struct Commit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner)]
    pub project: Box<Account<'info, Project>>,
    #[account(seeds=[b"vault",project.key().as_ref()],bump,constraint=vault.mint==project.mint,token::authority=project)]
    pub vault: Account<'info, TokenAccount>,
    #[account(init,payer=owner,space=8+Origin::INIT_SPACE,seeds=[b"origin",project.key().as_ref(),&source_digest],bump)]
    pub origin: Account<'info, Origin>,
    #[account(init,payer=owner,space=8+Obligation::INIT_SPACE,seeds=[b"award",project.key().as_ref(),&award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(actor_id:u64,network:[u8;32])]
pub struct BindWallet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub identity_authority: Signer<'info>,
    #[account(has_one=identity_authority)]
    pub project: Box<Account<'info, Project>>,
    #[account(init_if_needed,payer=payer,space=8+WalletBinding::INIT_SPACE,seeds=[b"wallet",identity_authority.key().as_ref(),&network,&actor_id.to_le_bytes()],bump)]
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
    #[account(seeds=[b"wallet",project.identity_authority.as_ref(),&project.network,&actor_id.to_le_bytes()],bump)]
    pub binding: Box<Account<'info, WalletBinding>>,
    #[account(init,payer=owner,space=8+BindingVeto::INIT_SPACE,seeds=[b"veto",project.key().as_ref(),&actor_id.to_le_bytes(),&version.to_le_bytes()],bump)]
    pub veto: Account<'info, BindingVeto>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    #[account(mut,has_one=project,seeds=[b"award",project.key().as_ref(),&obligation.award_id],bump)]
    pub obligation: Box<Account<'info, Obligation>>,
    #[account(seeds=[b"wallet",project.identity_authority.as_ref(),&project.network,&obligation.actor_id.to_le_bytes()],bump,constraint=binding.actor_id==obligation.actor_id,constraint=binding.network==project.network,constraint=binding.authority==project.identity_authority)]
    pub binding: Box<Account<'info, WalletBinding>>,
    pub mint: Account<'info, Mint>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,constraint=destination.owner==binding.destination,constraint=destination.key()==get_associated_token_address(&binding.destination,&mint.key()) @ EscrowError::WrongDestination,constraint=destination.key()!=vault.key())]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,constraint=fee_account.owner==project.fee_recipient,constraint=fee_account.key()!=vault.key())]
    pub fee_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: must be the empty veto address for this project, actor and binding version.
    #[account(seeds=[b"veto",project.key().as_ref(),&obligation.actor_id.to_le_bytes(),&binding.version.to_le_bytes()],bump)]
    pub veto: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(mut,has_one=owner,has_one=mint)]
    pub project: Box<Account<'info, Project>>,
    pub mint: Account<'info, Mint>,
    #[account(mut,seeds=[b"vault",project.key().as_ref()],bump,token::mint=mint,token::authority=project)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,token::authority=owner,constraint=destination.key()!=vault.key())]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,constraint=fee_account.owner==project.fee_recipient,constraint=fee_account.key()!=vault.key())]
    pub fee_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
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
}
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
}
#[account]
#[derive(InitSpace)]
pub struct BindingVeto {}
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
pub struct UnusedWithdrawn {
    pub project: Pubkey,
    pub gross: u64,
    pub fee: u64,
    pub returned: u64,
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
    #[msg("Only six decimal classic SPL tokens are supported")]
    WrongMint,
    #[msg("Award ID is not bound to this project and source")]
    InvalidAward,
    #[msg("Wallet binding is still in its activation delay")]
    BindingPending,
    #[msg("Project owner vetoed this wallet binding")]
    BindingVetoed,
    #[msg("Wallet binding is already active")]
    BindingActive,
    #[msg("Destination must be the bound wallet's associated token account")]
    WrongDestination,
}

#[account]
#[derive(InitSpace)]
pub struct Origin {
    pub obligation: Pubkey,
}
