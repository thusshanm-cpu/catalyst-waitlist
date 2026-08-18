/* ————————————————————————————————————————————————
   Icon system — @phosphor-icons/react (single family, regular weight).
   Thin wrappers keep the component names and `{ size, style }` props
   stable, so views don't care where the glyphs come from.
———————————————————————————————————————————————— */

import {
  Check as PCheck,
  Lock as PLock,
  LockSimpleOpen,
  Microphone,
  ArrowRight as PArrowRight,
  ArrowUpRight as PArrowUpRight,
  Sparkle,
  Lightning,
  PencilSimple,
  Eraser as PEraser,
  Trash as PTrash,
  PaperPlaneTilt,
  X as PX,
  Bug as PBug,
  Stack,
  ChartBar,
  Coins as PCoins,
  Megaphone as PMegaphone,
  PenNib,
  Compass as PCompass,
  Target as PTarget,
  Calculator as PCalculator,
  ShieldCheck,
  IdentificationCard,
  Camera as PCamera,
  Envelope,
  FileText as PFileText,
  Link as PLink,
  Bookmark as PBookmark,
  Calendar as PCalendar,
  ChatCircle,
  Warning as PWarning,
  Code as PCode,
  Fingerprint as PFingerprint,
  Building as PBuilding,
  GraduationCap as PGraduationCap,
  Handshake as PHandshake,
} from '@phosphor-icons/react'

const W = (C) => (p) => <C size={p.size ?? 16} style={p.style} weight="regular" aria-hidden />

export const Check = W(PCheck)
export const Lock = W(PLock)
export const Unlock = W(LockSimpleOpen)
export const Mic = W(Microphone)
export const ArrowRight = W(PArrowRight)
export const ArrowUpRight = W(PArrowUpRight)
export const Spark = W(Sparkle)
export const Zap = W(Lightning)
export const Pencil = W(PencilSimple)
export const Eraser = W(PEraser)
export const Trash = W(PTrash)
export const Send = W(PaperPlaneTilt)
export const X = W(PX)
export const Bug = W(PBug)
export const Layers = W(Stack)
export const Chart = W(ChartBar)
export const Coins = W(PCoins)
export const Megaphone = W(PMegaphone)
export const PenTool = W(PenNib)
export const Compass = W(PCompass)
export const Target = W(PTarget)
export const Calculator = W(PCalculator)
export const Shield = W(ShieldCheck)
export const IdCard = W(IdentificationCard)
export const Camera = W(PCamera)
export const Mail = W(Envelope)
export const FileText = W(PFileText)
export const Link = W(PLink)
export const Bookmark = W(PBookmark)
export const Calendar = W(PCalendar)
export const ChatBubble = W(ChatCircle)
export const AlertTriangle = W(PWarning)
export const Warning = W(PWarning)
export const Code = W(PCode)
export const Fingerprint = W(PFingerprint)
export const Building = W(PBuilding)
export const GraduationCap = W(PGraduationCap)
export const Handshake = W(PHandshake)

/* ————— Shared maps: role fields and simulation scenarios ————— */

export const FIELD_ICONS = {
  software: Code,
  civil: Layers,
  business: Chart,
  finance: Coins,
  marketing: Megaphone,
  design: PenTool,
  product: Compass,
  sales: Target,
  accounting: Calculator,
}

export const SIM_ICONS = {
  debug: Bug,
  system: Layers,
  pitch: Mic,
  campaign: Megaphone,
  funding: Coins,
  design: PenTool,
}
