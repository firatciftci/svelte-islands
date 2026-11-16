import { harbors } from "#lib/harrow.js";

export const ports = harbors(120, 101);
export const berths = harbors(3000, 202);

let movements = 0;
for (const row of ports) {
  movements += row.arrivals + row.departures;
}

export const summary = {
  movements,
  harbors: ports.length,
  berths: berths.length,
};
