/**
 * Data Storage Module
 *
 * File-based persistence for installations, tasks, and contexts
 * is only provided as a dev loop convenience
 * so the Forge App does not need to be uninstalled/installed
 * with an in-memory object.
 * Use a real database for production!
 */

import fs from "node:fs";
import path from "node:path";
import type { Task as BaseTask } from "forge-ahead";

/**
 * Extended Task type with additional metadata for our remote service
 */
export type Task = BaseTask & {
  userAccountId?: string;
  workItemId?: string;
  contextId: string;
  /** Simulation Scenario id matched for this task's streamed execution. */
  scenarioId?: string;
};

// ============================================================================
// Configuration
// ============================================================================

const DATA_DIR = path.join(process.cwd(), "database");
const DATA_FILE = path.join(DATA_DIR, "data.json");

// ============================================================================
// Types
// ============================================================================

export interface JiraInstallation {
  cloudId: string;
  installationId: string;
  baseUrl: string;
  installerAccountId: string;
  installedAt: string;
}

export interface AgentContext {
  id: string;
  userAccountId: string;
  workItemId?: string;
  cloudId: string;
  createdAt: string;
  messages: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: string;
  }>;
}

interface PersistenceData {
  installations: Array<[string, JiraInstallation]>;
  tasks: Array<[string, Task]>;
  contexts: Array<[string, AgentContext]>;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

export const installations = new Map<string, JiraInstallation>(); // cloudId -> installation
export const tasks = new Map<string, Task>(); // taskId -> task
export const contexts = new Map<string, AgentContext>(); // contextId -> context

// ============================================================================
// File Persistence Functions
// ============================================================================

export function saveData(): void {
  try {
    // Ensure database directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const data: PersistenceData = {
      installations: Array.from(installations.entries()),
      tasks: Array.from(tasks.entries()),
      contexts: Array.from(contexts.entries()),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to save data:", error);
  }
}

export function loadData(): void {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log("No data file found, starting fresh");
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf-8"),
    ) as PersistenceData;

    installations.clear();
    tasks.clear();
    contexts.clear();

    for (const [key, value] of data.installations) {
      installations.set(key, value);
    }
    for (const [key, value] of data.tasks) {
      tasks.set(key, value);
    }
    for (const [key, value] of data.contexts) {
      contexts.set(key, value);
    }

    console.log("Data loaded from file:", {
      installations: installations.size,
      tasks: tasks.size,
      contexts: contexts.size,
    });
  } catch (error) {
    console.error("Failed to load data:", error);
  }
}
