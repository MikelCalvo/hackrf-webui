import type { AdsbAircraftContact, AisVesselContact } from "@/lib/types";

export type ContactScope = "live" | "history" | "all";
export type AisMotionFilter = "all" | "moving" | "still";
export type AisContactSort = "recent" | "name" | "speed";
export type AdsbStateFilter = "all" | "airborne" | "ground" | "emergency";
export type AdsbContactSort = "recent" | "name" | "altitude";

export type AisContactFilters = {
  query: string;
  scope: ContactScope;
  motion: AisMotionFilter;
  sort: AisContactSort;
};

export type AdsbContactFilters = {
  query: string;
  scope: ContactScope;
  state: AdsbStateFilter;
  positionedOnly: boolean;
  sort: AdsbContactSort;
};

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function newestFirst(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function numericDescending(left: number | null, right: number | null): number {
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function filterAisContacts(
  contacts: AisVesselContact[],
  liveMmsi: ReadonlySet<string>,
  filters: AisContactFilters,
): AisVesselContact[] {
  return contacts
    .filter((contact) =>
      (filters.scope === "all" || (filters.scope === "live") === liveMmsi.has(contact.mmsi))
      && (filters.motion === "all" || (filters.motion === "moving") === contact.isMoving)
      && includesQuery([contact.mmsi, contact.name, contact.callsign, contact.imo, contact.shipType, contact.destination, contact.navStatus], filters.query),
    )
    .toSorted((left, right) => {
      if (filters.sort === "name") {
        return (left.name || left.callsign || left.mmsi).localeCompare(right.name || right.callsign || right.mmsi);
      }
      if (filters.sort === "speed") {
        return numericDescending(left.speedKnots, right.speedKnots) || newestFirst(left.lastSeenAt, right.lastSeenAt);
      }
      return newestFirst(left.lastSeenAt, right.lastSeenAt);
    });
}

export function filterAdsbContacts(
  contacts: AdsbAircraftContact[],
  liveHexes: ReadonlySet<string>,
  filters: AdsbContactFilters,
): AdsbAircraftContact[] {
  return contacts
    .filter((contact) =>
      (filters.scope === "all" || (filters.scope === "live") === liveHexes.has(contact.hex))
      && (!filters.positionedOnly || (contact.latitude !== null && contact.longitude !== null))
      && (filters.state === "all"
        || (filters.state === "airborne" && !contact.onGround && !contact.emergency)
        || (filters.state === "ground" && contact.onGround)
        || (filters.state === "emergency" && Boolean(contact.emergency)))
      && includesQuery([contact.hex, contact.flight, contact.type, contact.category, contact.squawk, contact.emergency, contact.sourceLabel], filters.query),
    )
    .toSorted((left, right) => {
      if (filters.sort === "name") {
        return (left.flight || left.hex).localeCompare(right.flight || right.hex);
      }
      if (filters.sort === "altitude") {
        return numericDescending(left.altitudeFeet, right.altitudeFeet) || newestFirst(left.seenAt, right.seenAt);
      }
      return newestFirst(left.seenAt, right.seenAt);
    });
}
