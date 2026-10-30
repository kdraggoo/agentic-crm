alter table "public"."deals" add column "propensity_override" text;

alter table "public"."deals"
    add constraint "deals_propensity_override_check"
        check ((propensity_override is null or propensity_override = any (array['low'::text, 'medium'::text, 'high'::text])))
        not valid;

alter table "public"."deals" validate constraint "deals_propensity_override_check";
