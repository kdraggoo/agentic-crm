import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { memoryStore } from "ra-core";
import { useEffect, useMemo } from "react";
import { MemoryRouter } from "react-router";
import cloneDeep from "lodash/cloneDeep";
import { toast } from "sonner";

import { Notification } from "@/components/admin/notification";
import { CRM } from "../root/CRM";
import {
  CONFIGURATION_STORE_KEY,
  type ConfigurationContextValue,
} from "../root/ConfigurationContext";
import { defaultConfiguration } from "../root/defaultConfiguration";
import { createDataProvider } from "../providers/fakerest";
import { DEFAULT_USER } from "../providers/fakerest/authProvider";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { frenchCrmMessages } from "../providers/commons/frenchCrmMessages";
import { createCrmDb } from "@/test/StoryWrapper";
import type { Deal, Sale } from "../types";
import { SalesFunnel } from "./SalesFunnel";

const baseSale: Sale = {
  administrator: true,
  avatar: DEFAULT_USER.avatar as Sale["avatar"],
  disabled: false,
  email: DEFAULT_USER.email,
  first_name: DEFAULT_USER.first_name,
  id: DEFAULT_USER.id,
  last_name: DEFAULT_USER.last_name,
  password: DEFAULT_USER.password,
  user_id: DEFAULT_USER.id.toString(),
};

const buildTestDeal = (overrides: Partial<Deal>): Deal =>
  ({
    amount: 1000,
    categories: [],
    company_id: 1,
    contact_ids: [],
    created_at: "2026-01-01",
    description: "",
    expected_closing_date: "2026-02-01",
    id: Math.floor(Math.random() * 100000),
    index: 0,
    name: "Deal",
    sales_id: baseSale.id,
    stage: "opportunity",
    updated_at: "2026-01-01",
    ...overrides,
  }) as Deal;

const authProvider = {
  canAccess: async () => true,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
  getIdentity: async () => ({
    id: baseSale.id,
    fullName: baseSale.email,
    avatar: baseSale.avatar?.src,
  }),
  login: async () => undefined,
  logout: async () => undefined,
};

interface HarnessProps {
  deals: Deal[];
  pipelineStatuses?: string[];
}

const Harness = ({ deals, pipelineStatuses }: HarnessProps) => {
  const dataProvider = useMemo(
    () =>
      createDataProvider({
        db: createCrmDb({ deals: cloneDeep(deals), sales: [baseSale] }),
        silent: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const store = useMemo(() => {
    const s = memoryStore();
    s.setItem(CONFIGURATION_STORE_KEY, {
      ...defaultConfiguration,
      ...(pipelineStatuses ? { dealPipelineStatuses: pipelineStatuses } : {}),
    } satisfies ConfigurationContextValue);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.clear();
    return () => {
      toast.dismiss();
    };
  }, []);

  return (
    <MemoryRouter>
      <CRM
        authProvider={authProvider}
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
        dashboard={() => <SalesFunnel />}
        store={store}
        disableTelemetry
        layout={({ children }) => (
          <>
            {children}
            <Notification />
          </>
        )}
      />
    </MemoryRouter>
  );
};

describe("SalesFunnel widget", () => {
  it("renders the 'Sales funnel' heading (AC1)", async () => {
    const screen = await render(
      <Harness
        deals={[
          buildTestDeal({ id: 1, stage: "opportunity" }),
          buildTestDeal({ id: 2, stage: "proposal-sent" }),
        ]}
      />,
    );

    await expect
      .element(screen.getByRole("heading", { name: "Sales funnel" }))
      .toBeInTheDocument();
  });

  it("shows the empty-state message when every included stage has 0 deals (AC5)", async () => {
    const screen = await render(<Harness deals={[]} />);

    await expect
      .element(screen.getByText("No active deals"))
      .toBeInTheDocument();

    await expect
      .element(screen.getByText("Opportunity"))
      .not.toBeInTheDocument();
  });

  it("uses semantic Tailwind tokens for the bar fill and track (AC9)", async () => {
    const screen = await render(
      <Harness
        deals={[
          buildTestDeal({ id: 1, stage: "opportunity" }),
          buildTestDeal({ id: 2, stage: "proposal-sent" }),
        ]}
      />,
    );

    await expect.element(screen.getByText("Opportunity")).toBeInTheDocument();

    const bar = screen.getByTestId("sales-funnel-bar-opportunity");
    await expect.element(bar).toBeInTheDocument();
    const trackEl = bar.element() as HTMLElement;
    expect(trackEl.className).toContain("bg-muted");
    const fillEl = trackEl.firstElementChild as HTMLElement;
    expect(fillEl.className).toContain("bg-primary");
  });

  it("renders rows only for stages NOT in dealPipelineStatuses (AC4)", async () => {
    const screen = await render(
      <Harness
        deals={[
          buildTestDeal({ id: 1, stage: "opportunity" }),
          buildTestDeal({ id: 2, stage: "won" }),
          buildTestDeal({ id: 3, stage: "lost" }),
          buildTestDeal({ id: 4, stage: "delayed" }),
        ]}
      />,
    );

    await expect.element(screen.getByText("Opportunity")).toBeInTheDocument();
    await expect.element(screen.getByText("Won")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Lost")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Delayed")).not.toBeInTheDocument();
  });

  it("adds a Lost row when 'lost' leaves dealPipelineStatuses (AC2 dynamic)", async () => {
    const screen = await render(
      <Harness
        deals={[buildTestDeal({ id: 1, stage: "lost", amount: 1234 })]}
        pipelineStatuses={["won", "delayed"]}
      />,
    );

    await expect.element(screen.getByText("Lost")).toBeInTheDocument();
    await expect.element(screen.getByText("Won")).not.toBeInTheDocument();
  });
});

describe("Sales funnel i18n keys (AC8)", () => {
  it("defines sales_funnel and sales_funnel_empty in both catalogs", () => {
    expect(englishCrmMessages.crm.dashboard.sales_funnel).toBe("Sales funnel");
    expect(englishCrmMessages.crm.dashboard.sales_funnel_empty).toBe(
      "No active deals",
    );

    expect(frenchCrmMessages.crm.dashboard.sales_funnel).toBeTruthy();
    expect(frenchCrmMessages.crm.dashboard.sales_funnel_empty).toBeTruthy();
    expect(typeof frenchCrmMessages.crm.dashboard.sales_funnel).toBe("string");
    expect(typeof frenchCrmMessages.crm.dashboard.sales_funnel_empty).toBe(
      "string",
    );
  });
});
