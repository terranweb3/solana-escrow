use anchor_lang::prelude::*;

declare_id!("HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n");

#[program]
pub mod solana_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
