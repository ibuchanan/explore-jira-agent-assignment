import api, { asApp, asUser } from "@forge/api";
import { describe, expect, it, vi } from "vitest";
import { getAuthForEvent } from "../../src/forge/auth";
import type { CommonEvent } from "../../src/forge/function";
import lifecycle from "../data/event/lifecycle.json";
import product from "../data/event/product.json";
import scheduled from "../data/event/scheduled.json";
import webtrigger from "../data/event/webtrigger.json";

// Mock @forge/api
vi.mock("@forge/api", () => {
  const asApp = vi.fn();
  const asUser = vi.fn();
  return {
    __esModule: true,
    default: {
      asApp,
      asUser,
    },
    asApp,
    asUser,
  };
});

describe("getAuthForEvent", () => {
  it("should return asUser(accountId) when installerAccountId is present", () => {
    const event: CommonEvent = {
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
      installerAccountId: "user-123",
    };

    getAuthForEvent(event, api);
    expect(asUser).toHaveBeenCalledWith("user-123");
  });

  it("should return asUser(accountId) when upgraderAccountId is present", () => {
    const event: CommonEvent = {
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
      upgraderAccountId: "user-456",
    };

    getAuthForEvent(event, api);
    expect(asUser).toHaveBeenCalledWith("user-456");
  });

  it("should return asUser() when context.userAccess.enabled is true", () => {
    const event: CommonEvent = {
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: true },
      },
    };

    getAuthForEvent(event, api);
    expect(asUser).toHaveBeenCalledWith();
  });

  it("should return asApp() when no user context is available", () => {
    const event: CommonEvent = {
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: false },
      },
    };

    getAuthForEvent(event, api);
    expect(asApp).toHaveBeenCalled();
  });

  it("should return asApp() from webtrigger events", () => {
    const event = webtrigger;
    getAuthForEvent(event, api);
    expect(asApp).toHaveBeenCalled();
  });

  it("should return asApp() from scheduled events", () => {
    const event = scheduled;
    getAuthForEvent(event, api);
    expect(asApp).toHaveBeenCalled();
  });

  it("should return asUser(accountId) from lifecycle events", () => {
    const event = lifecycle;
    getAuthForEvent(event, api);
    expect(asUser).toHaveBeenCalledWith(
      "557057:3d0e64ae-35d3-490d-b6d9-d81c981476d0",
    );
  });

  it("should return asUser() from product events", () => {
    const event = product;
    getAuthForEvent(event, api);
    expect(asUser).toHaveBeenCalled();
  });
});
