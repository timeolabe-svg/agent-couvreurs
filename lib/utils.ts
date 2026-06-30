export function formatDistanceToNow(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Date dans le FUTUR (ex: RDV à venir, relance programmée) → "dans X"
  if (diff < 0) {
    const m = Math.floor(-diff / 60000)
    const h = Math.floor(-diff / 3600000)
    const d = Math.floor(-diff / 86400000)
    if (m < 1) return "à l'instant"
    if (m < 60) return `dans ${m} min`
    if (h < 24) return `dans ${h}h`
    if (d === 1) return 'demain'
    return `dans ${d}j`
  }

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 60) return `il y a ${minutes} min`
  if (hours < 24) return `il y a ${hours}h`
  if (days === 1) return 'hier'
  return `il y a ${days}j`
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
