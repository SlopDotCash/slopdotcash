-- spec/fees/conversion.md, "A recorded send without a reservation is imported at its own worst case": an imported
-- historical send is a stored fact of its reservation, never inferred from its amount. The journal excludes it from
-- journaledGas and from the per-transaction check; every other reservation stays journaled. No earlier row is an
-- import: the fee converter has never run live, and the development Worker's imports stored no marker.
ALTER TABLE fee_native_gas ADD COLUMN imported INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1));
