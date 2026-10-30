import { required, useTranslate } from "ra-core";
import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";
import { ReferenceArrayInput } from "@/components/admin/reference-array-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";
import { AutocompleteContactInput } from "../contacts/AutocompleteContactInput.tsx";

export const DealInputs = () => {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-10 p-1">
      <DealInfoInputs />

      <div className={`flex gap-6 ${isMobile ? "flex-col" : "flex-row"}`}>
        <DealLinkedToInputs />
        <Separator orientation={isMobile ? "horizontal" : "vertical"} />
        <DealMiscInputs />
      </div>
    </div>
  );
};

const DealInfoInputs = () => {
  return (
    <div className="flex flex-col gap-4 flex-1">
      <TextInput source="name" validate={required()} helperText={false} />
      <TextInput source="description" multiline rows={3} helperText={false} />
    </div>
  );
};

const DealLinkedToInputs = () => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.inputs.linked_to")}
      </h6>
      <ReferenceInput source="company_id" reference="companies">
        <AutocompleteCompanyInput
          label="resources.deals.fields.company_id"
          validate={required()}
          modal
        />
      </ReferenceInput>

      <ReferenceArrayInput source="contact_ids" reference="contacts_summary">
        <AutocompleteContactInput label="resources.deals.fields.contact_ids" />
      </ReferenceArrayInput>
    </div>
  );
};

/**
 * Sentinel used in the form to represent "no override" (= Auto). The database
 * stores null in `deals.propensity_override` for that case; `parse`/`format`
 * below bridge the two. Never use it as a defaultValue: `parse` only runs on
 * change, so a new deal would be saved with "auto", which the database's
 * CHECK constraint rejects. `format` already shows Auto for an empty value. A non-empty sentinel keeps Base UI's Select happy
 * (an empty-string option value is treated as "nothing selected" there).
 */
const PROPENSITY_AUTO_VALUE = "auto";

/**
 * Propensity override options. Low/Medium/High match `deals.propensity_override`
 * stored values; Auto maps to null on save.
 */
const PROPENSITY_OVERRIDE_CHOICES: { id: string; name: string }[] = [
  { id: PROPENSITY_AUTO_VALUE, name: "crm.propensity.override_options.auto" },
  { id: "low", name: "crm.propensity.buckets.low" },
  { id: "medium", name: "crm.propensity.buckets.medium" },
  { id: "high", name: "crm.propensity.buckets.high" },
];

const DealMiscInputs = () => {
  const { dealStages, dealCategories } = useConfigurationContext();
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.field_categories.misc")}
      </h6>

      <AutocompleteArrayInput
        source="categories"
        choices={dealCategories}
        optionText="label"
        optionValue="value"
        helperText={false}
      />
      <NumberInput
        source="amount"
        defaultValue={0}
        helperText={false}
        validate={required()}
      />
      <DateInput
        validate={required()}
        source="expected_closing_date"
        helperText={false}
        defaultValue={new Date().toISOString().split("T")[0]}
      />
      <SelectInput
        source="stage"
        choices={dealStages}
        optionText="label"
        optionValue="value"
        defaultValue="opportunity"
        helperText={false}
        validate={required()}
      />
      <SelectInput
        source="propensity_override"
        label="resources.deals.fields.propensity_override"
        choices={PROPENSITY_OVERRIDE_CHOICES}
        optionText="name"
        optionValue="id"
        parse={(value: string) =>
          value === PROPENSITY_AUTO_VALUE ? null : value
        }
        format={(value: string | null | undefined) =>
          value ?? PROPENSITY_AUTO_VALUE
        }
        helperText={false}
      />
    </div>
  );
};
