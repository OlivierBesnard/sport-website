import { type BlockRegistry, coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchClientModules } from "../api/modules";
import { type LoadedModulePage, loadModuleClients, type ModuleClientProblem } from "./load-clients";

/**
 * The enabled modules, as the back-office uses them: the block registry of the editor (core
 * blocks + blocks of the modules, the same set the server renders), the pages of the modules,
 * and what went wrong loading them. Loaded once the session is open, and again after a module
 * is enabled or disabled (`refresh`).
 */
export interface ModulesState {
  /** `loading` until the first load is over (the editor waits: blocks would be missing). */
  readonly status: "loading" | "ready";
  readonly registry: BlockRegistry;
  readonly pages: readonly LoadedModulePage[];
  readonly problems: readonly ModuleClientProblem[];
  /** French message when the list of the enabled modules could not be read. */
  readonly error: string | undefined;
  readonly refresh: () => Promise<void>;
}

const coreRegistry = createBlockRegistry(coreBlocks);

const ModulesContext = createContext<ModulesState>({
  status: "ready",
  registry: coreRegistry,
  pages: [],
  problems: [],
  error: undefined,
  refresh: async () => undefined,
});

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ModulesState["status"]>("loading");
  const [registry, setRegistry] = useState<BlockRegistry>(coreRegistry);
  const [pages, setPages] = useState<readonly LoadedModulePage[]>([]);
  const [problems, setProblems] = useState<readonly ModuleClientProblem[]>([]);
  const [error, setError] = useState<string>();
  /** Number of the latest load: an older one finishing late must not win. */
  const loadRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    loadRef.current += 1;
    const load = loadRef.current;
    try {
      const entries = await fetchClientModules();
      const clients = await loadModuleClients(entries);
      if (load !== loadRef.current) {
        return;
      }
      setRegistry(createBlockRegistry([...coreBlocks, ...clients.blocks]));
      setPages(clients.pages);
      setProblems(clients.problems);
      setError(undefined);
    } catch (failure) {
      if (load !== loadRef.current) {
        return;
      }
      setRegistry(coreRegistry);
      setPages([]);
      setProblems([]);
      setError(
        failure instanceof Error ? failure.message : "Impossible de charger les modules activés.",
      );
    } finally {
      if (load === loadRef.current) {
        setStatus("ready");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, registry, pages, problems, error, refresh }),
    [status, registry, pages, problems, error, refresh],
  );
  return <ModulesContext value={value}>{children}</ModulesContext>;
}

export function useModules(): ModulesState {
  return useContext(ModulesContext);
}
