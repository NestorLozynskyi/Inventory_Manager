import { DocPage } from "./DocPage";
import { WRITE_OFF } from "./docs";

/** Write-off (screens/write-off.html): /write-offs/new and /write-offs/:id. */
export default function WriteOffPage() {
  return <DocPage cfg={WRITE_OFF} />;
}
