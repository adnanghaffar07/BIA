-- Frank Oct-2026: capture the co-insured (spouse) contact info too, not just the name.
-- Tracerfy returns both people at an address; the insured's own numbers fill phone1/2 +
-- email1/2, so the spouse's phone/email had nowhere to land. These give the spouse their
-- own slots → we can reach both, doubling deliverability/engagement on married households.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "owner2Phone" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "owner2Email" TEXT;
