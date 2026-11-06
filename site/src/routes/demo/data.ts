import { wards } from "#lib/harrow.js";

export const districts = wards(120, 101);
export const places = wards(3000, 202);

let votes = 0;
for (const row of districts) {
  votes += row.tide + row.beacon + row.harbor;
}

export const summary = {
  votes,
  districts: districts.length,
  places: places.length,
};
