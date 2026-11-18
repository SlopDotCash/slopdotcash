/**
 * A saved vault creation is registered by checks from the owner's page (PRD
 * section 6). The checks go on in a background tab, within their own limit,
 * so an owner who switches tabs still gets the vault recorded; and a deposit
 * into a vault that is not recorded yet says the vault is recorded first.
 * Model: formal/models/ui/ui_vault_auto_register.qnt.
 */
import { expect, test } from "bun:test";
import {
  AUTO_REGISTER_HIDDEN_ASKS,
  autoRegisterTurn,
  receivedNotice,
} from "../src/lib/vault-auto-register";

test("a visible tab asks and spends an attempt", () => {
  expect(autoRegisterTurn({ attempts: 3, hiddenAsks: 0 }, false)).toEqual({
    ask: true,
    next: { attempts: 4, hiddenAsks: 0 },
  });
});

test("a background tab still asks, on its own limit", () => {
  expect(autoRegisterTurn({ attempts: 3, hiddenAsks: 7 }, true)).toEqual({
    ask: true,
    next: { attempts: 3, hiddenAsks: 8 },
  });
});

test("a background tab stops asking at its limit and spends nothing", () => {
  const spent = { attempts: 3, hiddenAsks: AUTO_REGISTER_HIDDEN_ASKS };
  expect(autoRegisterTurn(spent, true)).toEqual({ ask: false, next: spent });
  // Showing the tab again resumes the visible attempts.
  expect(autoRegisterTurn(spent, false).ask).toBe(true);
});

test("a deposit into a recorded vault may be left alone", () => {
  expect(receivedNotice("deposit", "Base", "0xabc", false)).toBe(
    "Deposit received in a Base block. It counts once Base finalizes that block, usually within 20 minutes; you can leave this page. 0xabc",
  );
  expect(receivedNotice("withdraw", "Base", "0xabc", false)).toStartWith(
    "Withdrawal sent in a Base block.",
  );
});

test("a deposit into a vault that is not recorded yet says what happens first", () => {
  expect(receivedNotice("deposit", "Robinhood Chain", "0xabc", true)).toBe(
    "Deposit received in a Robinhood Chain block. The vault is recorded once Robinhood Chain finalizes its creation, usually within 20 minutes, and the deposit counts after that; you can leave this page. 0xabc",
  );
});
