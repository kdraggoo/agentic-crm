import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DataProviderContext,
  memoryStore,
  StoreContextProvider,
  type Store,
} from "ra-core";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import {
  CONFIGURATION_STORE_KEY,
  useConfigurationContext,
  type ConfigurationContextValue,
} from "./ConfigurationContext";
import { defaultDealPipelineStatuses } from "./defaultConfiguration";
import { useConfigurationLoader } from "./useConfigurationLoader";

/**
 * The behavior under test here is AC6: a fresh install (no saved config, i.e.
 * `getConfiguration` returns an empty object) must inherit the new default
 * `['won', 'lost', 'delayed']`, while an installation that already has a
 * saved `dealPipelineStatuses` value keeps whatever it saved — the default
 * change is applied only when the stored value is absent.
 *
 * This is split across two collaborators:
 * - `useConfigurationLoader` guards `updateConfiguration` with
 *   `Object.keys(data).length > 0`, so an empty row never clobbers the
 *   store, letting the next render fall back to defaults.
 * - `useConfigurationContext` spreads defaults first, then the stored
 *   config, so a saved value wins over the built-in default when present.
 *
 * The e2e for idea-12 covers the live demo path (empty row ⇒ defaults),
 * these unit tests pin the "existing install keeps its saved value" branch
 * that the browser build cannot assert against because the demo wipes the
 * store on every load.
 */

interface HarnessOptions {
  store?: Store;
  dataProvider?: { getConfiguration: () => Promise<unknown> };
}

const makeWrapper = ({ store, dataProvider }: HarnessOptions) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StoreContextProvider value={store ?? memoryStore()}>
          <DataProviderStub provider={dataProvider}>
            {children}
          </DataProviderStub>
        </StoreContextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return Wrapper;
};

// The configuration loader goes through `useDataProvider`, which looks up
// the current provider on `DataProviderContext`. We stub a minimal provider
// shape (`getConfiguration`) — the loader never calls anything else.
const DataProviderStub = ({
  provider,
  children,
}: {
  provider?: { getConfiguration: () => Promise<unknown> };
  children: ReactNode;
}) => (
  <DataProviderContext.Provider value={provider as never}>
    {children}
  </DataProviderContext.Provider>
);

describe("useConfigurationContext merge semantics", () => {
  it("falls back to the built-in default when no stored value exists", async () => {
    const store = memoryStore();
    const wrapper = makeWrapper({ store });

    const { result } = await renderHook(() => useConfigurationContext(), {
      wrapper,
    });

    expect(result.current.dealPipelineStatuses).toEqual(
      defaultDealPipelineStatuses,
    );
    // Sanity: the new default includes all three terminal stages.
    expect(result.current.dealPipelineStatuses).toEqual([
      "won",
      "lost",
      "delayed",
    ]);
  });

  it("keeps a stored dealPipelineStatuses value instead of applying the new default", async () => {
    // Simulate an installation that saved only ['won'] under the old default.
    const store = memoryStore({
      [CONFIGURATION_STORE_KEY]: {
        dealPipelineStatuses: ["won"],
      } as Partial<ConfigurationContextValue>,
    });
    const wrapper = makeWrapper({ store });

    const { result } = await renderHook(() => useConfigurationContext(), {
      wrapper,
    });

    expect(result.current.dealPipelineStatuses).toEqual(["won"]);
  });

  it("merges other fields from the default while preserving the stored dealPipelineStatuses", async () => {
    const store = memoryStore({
      [CONFIGURATION_STORE_KEY]: {
        dealPipelineStatuses: ["won"],
      } as Partial<ConfigurationContextValue>,
    });
    const wrapper = makeWrapper({ store });

    const { result } = await renderHook(() => useConfigurationContext(), {
      wrapper,
    });

    expect(result.current.dealPipelineStatuses).toEqual(["won"]);
    // Fields not in the stored config still come from the defaults, so a
    // partial saved config stays usable after new defaults ship.
    expect(result.current.dealStages.length).toBeGreaterThan(0);
    expect(result.current.title).toBeTruthy();
  });
});

describe("useConfigurationLoader", () => {
  it("does not overwrite the store when the saved configuration row is empty", async () => {
    const store = memoryStore();
    const setItem = vi.spyOn(store, "setItem");
    const dataProvider = {
      getConfiguration: vi.fn().mockResolvedValue({}),
    };
    const wrapper = makeWrapper({ store, dataProvider });

    await renderHook(() => useConfigurationLoader(), { wrapper });

    await vi.waitFor(() => {
      expect(dataProvider.getConfiguration).toHaveBeenCalled();
    });

    // Give the effect a chance to run before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const configWrites = setItem.mock.calls.filter(
      (call) => call[0] === CONFIGURATION_STORE_KEY,
    );
    expect(configWrites).toEqual([]);
  });

  it("writes the saved configuration to the store when it has keys", async () => {
    const store = memoryStore();
    const setItem = vi.spyOn(store, "setItem");
    const dataProvider = {
      getConfiguration: vi.fn().mockResolvedValue({
        dealPipelineStatuses: ["won"],
      }),
    };
    const wrapper = makeWrapper({ store, dataProvider });

    await renderHook(() => useConfigurationLoader(), { wrapper });

    await vi.waitFor(() => {
      const configWrites = setItem.mock.calls.filter(
        (call) => call[0] === CONFIGURATION_STORE_KEY,
      );
      expect(configWrites.length).toBeGreaterThan(0);
      // The exact object the server returned reaches the store, so
      // useConfigurationContext later spreads it over the defaults and the
      // saved ['won'] wins over the new default `['won','lost','delayed']`.
      expect(configWrites[0][1]).toEqual({ dealPipelineStatuses: ["won"] });
    });
  });
});
