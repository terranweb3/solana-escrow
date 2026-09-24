use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n");

#[program]
pub mod solana_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, id: u64, amount_offered: u64, amount_requested: u64) -> Result<()> {
        require!(amount_offered > 0 && amount_requested > 0, EscrowError::InvalidAmount);
        require_keys_neq!(ctx.accounts.offered_mint.key(), ctx.accounts.requested_mint.key(), EscrowError::SameMint);

        let escrow = &mut ctx.accounts.escrow;
        escrow.id = id;
        escrow.maker = ctx.accounts.maker.key();
        escrow.offered_mint = ctx.accounts.offered_mint.key();
        escrow.requested_mint = ctx.accounts.requested_mint.key();
        escrow.amount_offered = amount_offered;
        escrow.amount_requested = amount_requested;
        escrow.bump = ctx.bumps.escrow;

        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.maker_offered.to_account_info(),
                mint: ctx.accounts.offered_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            }),
            amount_offered,
            ctx.accounts.offered_mint.decimals,
        )?;

        emit!(EscrowMade { escrow: escrow.key(), maker: escrow.maker, id, offered_mint: escrow.offered_mint, requested_mint: escrow.requested_mint, amount_offered, amount_requested });
        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(ctx.accounts.vault.amount >= escrow.amount_offered, EscrowError::VaultUnderfunded);
        let id_bytes = escrow.id.to_le_bytes();
        let bump = [escrow.bump];
        let signer_seeds: &[&[u8]] = &[b"escrow", escrow.maker.as_ref(), &id_bytes, &bump];
        let signer = &[signer_seeds];

        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.taker_requested.to_account_info(),
                mint: ctx.accounts.requested_mint.to_account_info(),
                to: ctx.accounts.maker_requested.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            }),
            escrow.amount_requested,
            ctx.accounts.requested_mint.decimals,
        )?;
        token::transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.offered_mint.to_account_info(),
                to: ctx.accounts.taker_offered.to_account_info(),
                authority: escrow.to_account_info(),
            }, signer),
            escrow.amount_offered,
            ctx.accounts.offered_mint.decimals,
        )?;
        let surplus = ctx.accounts.vault.amount - escrow.amount_offered;
        if surplus > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.offered_mint.to_account_info(),
                    to: ctx.accounts.maker_offered.to_account_info(),
                    authority: escrow.to_account_info(),
                }, signer),
                surplus,
                ctx.accounts.offered_mint.decimals,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: escrow.to_account_info(),
        }, signer))?;

        emit!(EscrowTaken { escrow: escrow.key(), maker: escrow.maker, taker: ctx.accounts.taker.key(), id: escrow.id });
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let id_bytes = escrow.id.to_le_bytes();
        let bump = [escrow.bump];
        let signer_seeds: &[&[u8]] = &[b"escrow", escrow.maker.as_ref(), &id_bytes, &bump];
        let signer = &[signer_seeds];
        let amount = ctx.accounts.vault.amount;
        if amount > 0 {
            token::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.offered_mint.to_account_info(),
                to: ctx.accounts.maker_offered.to_account_info(),
                authority: escrow.to_account_info(),
            }, signer), amount, ctx.accounts.offered_mint.decimals)?;
        }
        token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: escrow.to_account_info(),
        }, signer))?;
        emit!(EscrowCancelled { escrow: escrow.key(), maker: escrow.maker, id: escrow.id });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Make<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    pub offered_mint: Account<'info, Mint>,
    pub requested_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = offered_mint, associated_token::authority = maker)]
    pub maker_offered: Account<'info, TokenAccount>,
    #[account(init, payer = maker, space = 8 + Escrow::INIT_SPACE, seeds = [b"escrow", maker.key().as_ref(), &id.to_le_bytes()], bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(init, payer = maker, associated_token::mint = offered_mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut, address = escrow.maker)]
    pub maker: SystemAccount<'info>,
    #[account(mut, close = maker, seeds = [b"escrow", escrow.maker.as_ref(), &escrow.id.to_le_bytes()], bump = escrow.bump,
        has_one = offered_mint, has_one = requested_mint)]
    pub escrow: Account<'info, Escrow>,
    pub offered_mint: Account<'info, Mint>,
    pub requested_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = offered_mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = taker, associated_token::mint = requested_mint, associated_token::authority = maker)]
    pub maker_requested: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = taker, associated_token::mint = offered_mint, associated_token::authority = maker)]
    pub maker_offered: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = taker, associated_token::mint = offered_mint, associated_token::authority = taker)]
    pub taker_offered: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = requested_mint, associated_token::authority = taker)]
    pub taker_requested: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(mut, close = maker, seeds = [b"escrow", maker.key().as_ref(), &escrow.id.to_le_bytes()], bump = escrow.bump,
        has_one = maker, has_one = offered_mint)]
    pub escrow: Account<'info, Escrow>,
    pub offered_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = offered_mint, associated_token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = maker, associated_token::mint = offered_mint, associated_token::authority = maker)]
    pub maker_offered: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub id: u64,
    pub maker: Pubkey,
    pub offered_mint: Pubkey,
    pub requested_mint: Pubkey,
    pub amount_offered: u64,
    pub amount_requested: u64,
    pub bump: u8,
}

#[event]
pub struct EscrowMade {
    pub escrow: Pubkey,
    pub maker: Pubkey,
    pub id: u64,
    pub offered_mint: Pubkey,
    pub requested_mint: Pubkey,
    pub amount_offered: u64,
    pub amount_requested: u64,
}

#[event]
pub struct EscrowTaken {
    pub escrow: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub id: u64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub maker: Pubkey,
    pub id: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amounts must be greater than zero")]
    InvalidAmount,
    #[msg("Offered and requested mints must differ")]
    SameMint,
    #[msg("The vault contains less than the offered amount")]
    VaultUnderfunded,
}
