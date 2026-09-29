import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Download, FileJson, FileText } from 'lucide-react'

export function ExportMenu({ enabled, highlight, onPdf, onJson }: { enabled: boolean; highlight: boolean; onPdf: () => void; onJson: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button
        disabled={!enabled}
        onClick={() => setOpen(!open)}
        title={enabled ? 'Download the Cryptographic Bill of Materials' : 'Run a scan first'}
        className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] font-medium backdrop-blur-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          highlight ? 'border-white bg-white text-black hover:bg-zinc-200' : 'border-white/10 bg-zinc-950/60 text-zinc-200 hover:border-white/20'
        }`}
      >
        <Download size={14} /> <span className="hidden sm:inline">Export CBOM Report (PDF/JSON)</span>
        <span className="sm:hidden">Export</span> <ChevronDown size={13} />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur-lg"
        >
          {[
            { icon: <FileText size={15} />, label: 'PDF report', hint: 'For compliance and audit', run: onPdf },
            { icon: <FileJson size={15} />, label: 'CycloneDX 1.6 JSON', hint: 'Machine-readable CBOM', run: onJson },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => {
                o.run()
                setOpen(false)
              }}
              className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              <span className="mt-0.5 text-zinc-400">{o.icon}</span>
              <span>
                <span className="block text-[13px] text-white">{o.label}</span>
                <span className="block text-[12px] text-zinc-500">{o.hint}</span>
              </span>
            </button>
          ))}
        </motion.div>
      )}
    </div>
  )
}
