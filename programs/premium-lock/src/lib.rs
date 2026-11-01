use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

// Local prototype ID only. Replace with the audited deployment's program ID.
declare_id!("33x8p1LJk1YMNuC5D4NSGoaNonp4pzbCPuBKejF7g7iQ");

const CONFIG_SEED: &[u8] = b"config";
const POSITION_SEED: &[u8] = b"position";
const SEVEN_DAYS: i64 = 7 * 24 * 60 * 60;

#[program]
pub mod whoaped_premium_lock {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, minimum_amount: u64, pause_authority: Pubkey) -> Result<()> {
        require!(minimum_amount > 0, LockError::InvalidAmount);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pause_authority = pause_authority;
        config.mint = ctx.accounts.mint.key();
        config.minimum_amount = minimum_amount;
        config.cooldown_seconds = SEVEN_DAYS;
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn lock(ctx: Context<Lock>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, LockError::Paused);
        // Exactly one membership deposit; never silently lock more than the advertised amount.
        require!(amount == config.minimum_amount, LockError::InvalidAmount);
        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.owner_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            }),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let position = &mut ctx.accounts.position;
        position.owner = ctx.accounts.owner.key();
        position.config = config.key();
        position.amount = amount;
        position.unlock_at = 0;
        position.bump = ctx.bumps.position;
        Ok(())
    }

    pub fn request_unlock(ctx: Context<ManagePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(position.unlock_at == 0, LockError::AlreadyUnlocking);
        position.unlock_at = unlock_deadline(Clock::get()?.unix_timestamp, ctx.accounts.config.cooldown_seconds)?;
        Ok(())
    }

    pub fn cancel_unlock(ctx: Context<ManagePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(position.unlock_at > 0, LockError::NotUnlocking);
        position.unlock_at = 0;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        require!(ctx.accounts.position.unlock_at > 0, LockError::NotUnlocking);
        require!(Clock::get()?.unix_timestamp >= ctx.accounts.position.unlock_at, LockError::CooldownActive);
        transfer_back(ctx)
    }

    pub fn emergency_withdraw(ctx: Context<Withdraw>) -> Result<()> {
        require!(ctx.accounts.config.paused, LockError::NotPaused);
        transfer_back(ctx)
    }
}

fn unlock_deadline(now: i64, cooldown: i64) -> Result<i64> {
    now.checked_add(cooldown).ok_or(error!(LockError::TimeOverflow))
}

fn transfer_back(ctx: Context<Withdraw>) -> Result<()> {
    let config = &ctx.accounts.config;
    let signer: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.owner_tokens.to_account_info(),
            authority: config.to_account_info(),
        }, &[signer]),
        ctx.accounts.position.amount,
        ctx.accounts.mint.decimals,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = admin, associated_token::mint = mint, associated_token::authority = config)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.pause_authority == pause_authority.key() @ LockError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub pause_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Lock<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = config)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManagePosition<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump = position.bump, has_one = owner, has_one = config)]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mut, close = owner, seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump = position.bump, has_one = owner, has_one = config)]
    pub position: Account<'info, Position>,
    pub mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = owner, associated_token::mint = mint, associated_token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = config)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pause_authority: Pubkey,
    pub mint: Pubkey,
    pub minimum_amount: u64,
    pub cooldown_seconds: i64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub config: Pubkey,
    pub amount: u64,
    pub unlock_at: i64,
    pub bump: u8,
}

#[error_code]
pub enum LockError {
    #[msg("Invalid lock amount")] InvalidAmount,
    #[msg("New deposits are paused")] Paused,
    #[msg("Only the pause authority may change this setting")] Unauthorized,
    #[msg("Unlock has already been requested")] AlreadyUnlocking,
    #[msg("Request unlock first")] NotUnlocking,
    #[msg("The 7-day cooldown is still active")] CooldownActive,
    #[msg("Emergency withdrawal requires a paused pool")] NotPaused,
    #[msg("Unlock deadline overflow")] TimeOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seven_day_deadline_is_exact() {
        assert_eq!(unlock_deadline(1_700_000_000, SEVEN_DAYS).unwrap(), 1_700_604_800);
    }

    #[test]
    fn deadline_cannot_overflow() {
        assert!(unlock_deadline(i64::MAX, SEVEN_DAYS).is_err());
    }
}
