import { DocListPage } from "./DocList";
import { WRITE_OFF } from "./docs";

/** Write-offs list (screens/write-offs.html): write-offs and write-off reversals. */
export default function WriteOffList() {
  return (
    <DocListPage
      cfg={WRITE_OFF}
      texts={{
        subtitle:
          "Stock leaving the warehouse: sales, damage, expiry, loss and internal use. Posting a write-off reduces stock. Values are at average cost.",
        searchLabel: "Search write-offs by number or note",
        searchPlaceholder: "Search by number or note",
        emptyIcon: "arrow-up-from-line",
        emptyTitle: "No write-offs yet",
        emptyText:
          "Record stock that leaves the warehouse — sales, damaged or expired goods, losses and internal use. Posting a write-off reduces stock.",
        noResultsText: "Try a different period, status, reason or search term.",
      }}
    />
  );
}
