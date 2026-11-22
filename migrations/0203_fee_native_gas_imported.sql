-- spec/fees/conversion.md, "A recorded send without a reservation is imported at its own worst case": an imported
-- historical send is a stored fact of its reservation, never inferred from its amount at read time. The journal
-- excludes it from journaledGas and from the per-transaction check; every other reservation stays journaled.
-- The development fee converter has run live since 25 October 2026 and imported, without a marker, the EVM sends it
-- had recorded before native gas was reserved (workers/fee-converter/native-gas.ts importRecorded). An ordinary
-- reservation is admitted only within its stored per-transaction ceiling, so every stored EVM row above that ceiling
-- is such an import and is marked here. An import at or below its ceiling stays journaled: it is counted against the
-- daily budget, which only refuses more, and it already passes the per-transaction check.
ALTER TABLE fee_native_gas ADD COLUMN imported INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1));
UPDATE fee_native_gas SET imported = 1
 WHERE network IN ('base', 'ethereum', 'robinhood')
   AND (length(maximum_wei) > length(per_transaction_wei)
     OR (length(maximum_wei) = length(per_transaction_wei) AND maximum_wei > per_transaction_wei));
CREATE TRIGGER fee_native_gas_imported_immutable BEFORE UPDATE ON fee_native_gas
WHEN NEW.imported IS NOT OLD.imported
BEGIN SELECT RAISE(ABORT, 'native gas import marker is immutable'); END;
