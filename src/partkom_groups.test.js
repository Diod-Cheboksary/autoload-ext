import { describe, expect, it } from "vitest";
import { parsePartkomGroups } from "./partkom_groups.js";

const GUID_A = "911ef7d6-57c0-4c33-82cb-85b8765f581b";
const GUID_B = "00000000-1111-2222-3333-444444444444";

function trackingCell(guid) {
  return `<td><a title="Отслеживание доставки"><opt-tracking link="https://b2b.part-kom.ru/track/${guid}"></opt-tracking> <opt-ttr></opt-ttr></a></td>`;
}

// Повторяет реальную структуру motion.php: заказ = N строк, первая несёт
// "№ УАК…" через rowspan, иконка трекинга — в каждой строке позиции.
const FIXTURE = `<html><body><table>
<tr>
  <td rowspan="2"><input type="checkbox"></td>
  <td rowspan="2"><div> №&nbsp;УАК55904265 <br><small>от 11/06 в 17:16(МСК)</small></div></td>
  <td>E410154 MILES</td>${trackingCell(GUID_A)}
</tr>
<tr><td>E400025 MILES</td>${trackingCell(GUID_A)}</tr>
<tr>
  <td><div> №&nbsp;УАК55904258 </div></td>
  <td>7058 SEVI</td>${trackingCell(GUID_A)}
</tr>
<tr>
  <td><div> №&nbsp;УАК55921227 </div></td>
  <td>XX111</td>${trackingCell(GUID_B)}
</tr>
<tr>
  <td><div> №&nbsp;УАК55812874 </div></td>
  <td>старый заказ, иконки нет</td>
</tr>
</table></body></html>`;

describe("parsePartkomGroups", () => {
  it("maps each order to its tracking GUID", () => {
    const { orderToGuid } = parsePartkomGroups(FIXTURE);
    expect(orderToGuid["55904265"]).toBe(GUID_A);
    expect(orderToGuid["55904258"]).toBe(GUID_A);
    expect(orderToGuid["55921227"]).toBe(GUID_B);
  });

  it("groups orders sharing a GUID", () => {
    const { guidToOrders } = parsePartkomGroups(FIXTURE);
    expect(guidToOrders[GUID_A]).toEqual(["55904265", "55904258"]);
    expect(guidToOrders[GUID_B]).toEqual(["55921227"]);
  });

  it("omits orders without a tracking icon", () => {
    const { orderToGuid } = parsePartkomGroups(FIXTURE);
    expect(orderToGuid["55812874"]).toBeUndefined();
  });

  it("reads Vue-bound :link attribute too", () => {
    const html = `<table><tr><td>№ УАК55000001</td>
      <td><opt-tracking :link="'https://x/track/${GUID_A}'"></opt-tracking></td></tr></table>`;
    expect(parsePartkomGroups(html).orderToGuid["55000001"]).toBe(GUID_A);
  });

  it("ignores tracking links without a UUID", () => {
    const html = `<table><tr><td>№ УАК55000002</td>
      <td><opt-tracking link="javascript:void(0)"></opt-tracking></td></tr></table>`;
    expect(parsePartkomGroups(html).orderToGuid["55000002"]).toBeUndefined();
  });

  it("ignores icons that appear before any order number", () => {
    const html = `<table><tr>${trackingCell(GUID_A)}</tr></table>`;
    expect(parsePartkomGroups(html).guidToOrders).toEqual({});
  });
});
