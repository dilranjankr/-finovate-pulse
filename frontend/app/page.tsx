import CommandCenter from "./components/CommandCenter";
import { getFilters, getCommand, defaultRange, type FilterOptions, type CommandData } from "./lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let opts: FilterOptions | null = null;
  let data: CommandData | null = null;
  try {
    opts = await getFilters();
    data = await getCommand(defaultRange(opts));
  } catch {
    // backend unreachable at render — client retries on mount
  }
  return <CommandCenter initialOpts={opts} initialData={data} />;
}
