BEGIN;
CREATE OR REPLACE FUNCTION careflow_note_search_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', COALESCE(NEW.soap::text, ''));
  RETURN NEW;
END;
$$;
CREATE TRIGGER careflow_note_search_trigger BEFORE INSERT OR UPDATE OF soap ON "ClinicalNote" FOR EACH ROW EXECUTE FUNCTION careflow_note_search_update();
UPDATE "ClinicalNote" SET "searchVector" = to_tsvector('english', COALESCE(soap::text, ''));
COMMIT;
