import { DocListPage } from "./DocList";
import { RECEIPT } from "./docs";

/** Receipts list (screens/receipts.html): receipts and receipt reversals. */
export default function ReceiptList() {
  return (
    <DocListPage
      cfg={RECEIPT}
      texts={{
        subtitle: "Goods received from suppliers. Posting a receipt adds its quantities to stock.",
        searchLabel: "Search receipts by number or supplier",
        searchPlaceholder: "Search by number or supplier",
        emptyIcon: "arrow-down-to-line",
        emptyTitle: "No receipts yet",
        emptyText:
          "Record goods you receive from suppliers. When you post a receipt, its quantities are added to stock.",
        noResultsText: "Try a different period, status or search term.",
      }}
    />
  );
}
