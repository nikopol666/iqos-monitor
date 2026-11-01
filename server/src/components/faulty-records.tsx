"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw, Trash2 } from "lucide-react";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { Card, CardTitle, Notice } from "@/components/ui";

export interface FaultyRecord {
  eventId: number;
  timestampUtc: string | null;
  status: string;
  puffCount: number | null;
  clockSuspect: boolean;
}
export interface BlockRow {
  eventId: number;
  mode: "deleted" | "blocked";
  createdUtc: string;
}

/**
 * Records that look wrong (invalid status or a suspicious clock) with two ways
 * out: delete (gone, not re-synced automatically, comes back with a full
 * history download) or block (never read from the device again). Both are
 * reversible from the list below.
 */
export function FaultyRecords({ serial, faulty, blocks }: { serial: string; faulty: FaultyRecord[]; blocks: BlockRow[] }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(eventId: number, action: "delete" | "block" | "restore") {
    if (action !== "restore" && !confirm(f(action === "delete" ? t.device.confirmDelete : t.device.confirmBlock, { id: eventId }))) return;
    setBusy(eventId);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${serial}/records`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_id: eventId, action }) });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = (s: string) => (t.status as Record<string, string>)[s] ?? s;

  return (
    <Card>
      <CardTitle right={<span className="text-xs text-muted">{faulty.length}</span>}>{t.device.faultyTitle}</CardTitle>
      <p className="mb-3 text-xs text-text-2">{t.device.faultyHint}</p>
      {error ? <Notice>{t.common.error}</Notice> : null}
      {faulty.length === 0 ? (
        <div className="text-sm text-muted">{t.device.faultyNone}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-2">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t.device.colId}</th>
                <th className="py-1.5 pr-3 font-medium">{t.device.colTime}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t.device.colPuffs}</th>
                <th className="py-1.5 pr-3 font-medium">{t.device.faultyWhy}</th>
                <th className="py-1.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="tabular">
              {faulty.map((r) => (
                <tr key={r.eventId} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.eventId}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.timestampUtc ? fmt.dateTimeSec(r.timestampUtc) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right">{r.puffCount ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-xs text-text-2">
                    {r.status !== "ok" ? statusLabel(r.status) : null}
                    {r.status !== "ok" && r.clockSuspect ? " · " : null}
                    {r.clockSuspect ? t.device.clockSuspectShort : null}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <button type="button" className="ui-btn h-7 text-xs" disabled={busy === r.eventId} onClick={() => act(r.eventId, "delete")} title={t.device.actionDeleteHint}>
                      <Trash2 size={13} aria-hidden /> {t.device.actionDelete}
                    </button>
                    <button type="button" className="ui-btn ml-1 h-7 text-xs text-critical" disabled={busy === r.eventId} onClick={() => act(r.eventId, "block")} title={t.device.actionBlockHint}>
                      <Ban size={13} aria-hidden /> {t.device.actionBlock}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {blocks.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-text-2">
            {t.device.blockedList} · {blocks.length}
          </summary>
          <table className="mt-2 w-full text-xs">
            <tbody className="tabular">
              {blocks.map((b) => (
                <tr key={b.eventId} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{b.eventId}</td>
                  <td className="py-1 pr-3">{b.mode === "blocked" ? t.device.blockedTag : t.device.deletedTag}</td>
                  <td className="py-1 pr-3 whitespace-nowrap text-muted">{fmt.dateTime(b.createdUtc)}</td>
                  <td className="py-1 text-right">
                    <button type="button" className="ui-btn h-6 text-[11px]" disabled={busy === b.eventId} onClick={() => act(b.eventId, "restore")} title={t.device.actionRestoreHint}>
                      <RotateCcw size={11} aria-hidden /> {t.device.actionRestore}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </Card>
  );
}
