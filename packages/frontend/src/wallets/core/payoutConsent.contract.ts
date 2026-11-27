// spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"
import { vectors } from "../../kernels/vectors.ts";
import { preparedBindingShape, signedCompletesPrepared, unsignedWireOf } from "./solanaWire.ts";

const message = Uint8Array.from({ length: 40 }, (_, index) => index + 1);
const unsigned = Uint8Array.from([1, ...new Array<number>(64).fill(0), ...message]);
const signedSlot = Uint8Array.from([1, 9, ...new Array<number>(63).fill(0), ...message]);
const changedMessage = Uint8Array.from([1, ...new Array<number>(64).fill(0), ...message.map((byte, index) => (index === 39 ? byte ^ 1 : byte))]);

const count = 6;
const destination = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const messageBytes = [2, 1, 3, count, ...new Array<number>(32).fill(11), ...destination, ...new Array<number>(32 * (count - 2) + 32 + 8 + 96).fill(13)];
const prepared = Uint8Array.from([2, ...new Array<number>(64).fill(7), ...new Array<number>(64).fill(0), ...messageBytes]);
const signed = Uint8Array.from([2, ...new Array<number>(64).fill(7), ...new Array<number>(64).fill(5), ...messageBytes]);
const reSigned = Uint8Array.from([2, ...new Array<number>(64).fill(8), ...new Array<number>(64).fill(5), ...messageBytes]);
const otherDestination = Uint8Array.from(destination, (byte) => byte ^ 1);
const prefilled = Uint8Array.from([2, ...new Array<number>(64).fill(7), 1, ...new Array<number>(63).fill(0), ...messageBytes]);

export const anUnsignedWireIsExactlyTheReviewedMessage = vectors<readonly [Uint8Array, Uint8Array], boolean>([
  [[unsigned, message], true],
  [[signedSlot, message], false],
  [[changedMessage, message], false],
  [[unsigned.slice(0, 104), message], false],
  [[Uint8Array.from([2, ...unsigned.slice(1)]), message], false],
], ([wire, reviewed]) => unsignedWireOf(wire, reviewed));

export const aPreparedBindingHasOneAttesterSignatureAndAnEmptyWalletSlot = vectors<Uint8Array, boolean>([
  [prepared, true],
  [prefilled, false],
  [prepared.slice(0, 200), false],
  [Uint8Array.from([1, ...prepared.slice(1)]), false],
], preparedBindingShape);

export const onlyTheWalletSlotChangesWhenTheDestinationSigns = vectors<readonly [Uint8Array, Uint8Array, Uint8Array], boolean>([
  [[prepared, signed, destination], true],
  [[prepared, reSigned, destination], false],
  [[prepared, signed, otherDestination], false],
  [[prepared, signed.slice(0, signed.length - 1), destination], false],
], ([before, after, key]) => signedCompletesPrepared(before, after, key));
