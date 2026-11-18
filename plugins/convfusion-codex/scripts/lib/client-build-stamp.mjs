/** Beijing time recorded when the workbench bundle is built. */
export function clientBuildStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const { year, month, day, hour, minute } = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${year}${month}${day}-${hour}${minute}`
}
