import CommandCenter from "./components/CommandCenter";
import { getFilters, getCommand, type FilterOptions, type CommandData } from "./lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let opts: FilterOptions | null = null;
  let data: CommandData | null = null;
  try {
    opts = await getFilters();
    data = await getCommand({ date_from: opts.date_min, date_to: opts.date_max });
  } catch {
    // backend unreachable at render — client retries on mount
  }
  return <CommandCenter initialOpts={opts} initialData={data} />;
}
