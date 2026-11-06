import { DocPage } from "./DocPage";
import { RECEIPT } from "./docs";

/** Receipt (screens/receipt.html): /receipts/new and /receipts/:id. */
export default function ReceiptPage() {
  return <DocPage cfg={RECEIPT} />;
}
