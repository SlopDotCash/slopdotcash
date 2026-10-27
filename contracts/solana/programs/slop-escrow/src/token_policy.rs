//! Token-2022 admission is deliberately narrower than TokenInterface ownership.
use crate::EscrowError;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        immutable_owner::ImmutableOwner, metadata_pointer::MetadataPointer,
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    state::{Account as TokenState, AccountState, Mint as MintState},
};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata;

pub fn admitted_mint(info: &AccountInfo) -> Result<bool> {
    if info.owner == &anchor_spl::token::ID {
        return Ok(true); // Existing classic SPL admission and authorities remain unchanged.
    }
    require_keys_eq!(
        *info.owner,
        anchor_spl::token_2022::ID,
        EscrowError::WrongMint
    );
    let data = info.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    require!(
        state.base.mint_authority.is_none() && state.base.freeze_authority.is_none(),
        EscrowError::UnsupportedTokenExtension
    );
    let types = state.get_extension_types()?;
    require!(types.len() <= 2, EscrowError::UnsupportedTokenExtension);
    for (index, kind) in types.iter().enumerate() {
        require!(
            !types[..index].contains(kind),
            EscrowError::UnsupportedTokenExtension
        );
        match kind {
            ExtensionType::MetadataPointer => {
                state.get_extension::<MetadataPointer>()?;
            }
            ExtensionType::TokenMetadata => {
                let metadata = state.get_variable_len_extension::<TokenMetadata>()?;
                require_keys_eq!(metadata.mint, *info.key, EscrowError::WrongMint);
            }
            _ => return err!(EscrowError::UnsupportedTokenExtension),
        }
    }
    Ok(true)
}

pub fn admitted_token_account(info: &AccountInfo) -> Result<bool> {
    if info.owner == &anchor_spl::token::ID {
        return Ok(true);
    }
    require_keys_eq!(
        *info.owner,
        anchor_spl::token_2022::ID,
        EscrowError::WrongMint
    );
    let data = info.try_borrow_data()?;
    let state = StateWithExtensions::<TokenState>::unpack(&data)?;
    require!(
        state.base.state == AccountState::Initialized,
        EscrowError::UnsupportedTokenExtension
    );
    let types = state.get_extension_types()?;
    require!(types.len() <= 1, EscrowError::UnsupportedTokenExtension);
    for kind in types {
        require!(
            kind == ExtensionType::ImmutableOwner,
            EscrowError::UnsupportedTokenExtension
        );
        state.get_extension::<ImmutableOwner>()?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_spl::token_2022::spl_token_2022::extension::{
        memo_transfer::MemoTransfer, BaseStateWithExtensionsMut, StateWithExtensionsMut,
    };

    fn inspect_mint(mut bytes: Vec<u8>) -> Result<bool> {
        let key = anchor_lang::solana_program::pubkey::pubkey!(
            "3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh"
        );
        let owner = anchor_spl::token_2022::ID;
        let mut lamports = 10_000_000;
        let info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &owner,
            false,
            0,
        );
        admitted_mint(&info)
    }

    #[test]
    fn synthetic_metadata_mint_is_admitted_but_active_authorities_are_not() {
        let bytes = include_bytes!("../../../integration/fixtures/token-2022-mint.bin");
        assert!(inspect_mint(bytes.to_vec()).unwrap());
        for offset in [0, 46] {
            let mut active = bytes.to_vec();
            active[offset..offset + 4].copy_from_slice(&1u32.to_le_bytes());
            active[offset + 4..offset + 36].fill(9);
            assert!(inspect_mint(active).is_err());
        }
    }

    #[test]
    fn revoked_authorities_keep_key_bytes_but_are_no_longer_authorities() {
        use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
        let mut bytes = include_bytes!("../../../integration/fixtures/token-2022-mint.bin").to_vec();
        let mut mint = MintState::unpack(&bytes[..82]).unwrap();
        mint.mint_authority = COption::Some(Pubkey::new_from_array([9; 32]));
        mint.freeze_authority = COption::Some(Pubkey::new_from_array([7; 32]));
        MintState::pack(mint, &mut bytes[..82]).unwrap();
        assert!(inspect_mint(bytes.clone()).is_err());
        mint.mint_authority = COption::None;
        mint.freeze_authority = COption::None;
        MintState::pack(mint, &mut bytes[..82]).unwrap();
        assert_eq!(&bytes[4..36], &[9; 32]);
        assert_eq!(&bytes[50..82], &[7; 32]);
        assert!(inspect_mint(bytes).unwrap());
    }

    #[test]
    fn economic_hooks_and_unknown_mint_extensions_are_refused() {
        for kind in [
            ExtensionType::TransferFeeConfig as u16,
            ExtensionType::TransferHook as u16,
            60_000,
        ] {
            let mut bytes = include_bytes!("../../../integration/fixtures/token-2022-mint.bin").to_vec();
            bytes[166..168].copy_from_slice(&kind.to_le_bytes());
            assert!(inspect_mint(bytes).is_err());
        }
    }

    #[test]
    fn immutable_owner_account_is_admitted_but_even_disabled_memo_extension_is_not() {
        for allowed in [true, false] {
            let extension = if allowed {
                ExtensionType::ImmutableOwner
            } else {
                ExtensionType::MemoTransfer
            };
            let mut bytes =
                vec![
                    0;
                    ExtensionType::try_calculate_account_len::<TokenState>(&[extension]).unwrap()
                ];
            let mut state =
                StateWithExtensionsMut::<TokenState>::unpack_uninitialized(&mut bytes).unwrap();
            if allowed {
                state.init_extension::<ImmutableOwner>(true).unwrap();
            } else {
                state.init_extension::<MemoTransfer>(true).unwrap();
            }
            state.base = TokenState {
                state: AccountState::Initialized,
                amount: 1_000_000,
                ..TokenState::default()
            };
            state.pack_base();
            state.init_account_type().unwrap();
            let key = Pubkey::new_unique();
            let owner = anchor_spl::token_2022::ID;
            let mut lamports = 10_000_000;
            let info = AccountInfo::new(
                &key,
                false,
                false,
                &mut lamports,
                &mut bytes,
                &owner,
                false,
                0,
            );
            if allowed {
                assert!(admitted_token_account(&info).unwrap());
            } else {
                assert!(admitted_token_account(&info).is_err());
            }
        }
    }
}
