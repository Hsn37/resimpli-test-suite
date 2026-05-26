export type CallMode = "inbound" | "outbound_followup" | "speed_to_lead";

export interface CallModeConfig {
  label: string;
  description: string;
  callType: string;
  firstSpeaker: "agent" | "user";
}

export const CALL_MODES: Record<CallMode, CallModeConfig> = {
  inbound: {
    label: "Inbound",
    description: "Caller dials in — AI speaks first",
    callType: "inbound",
    firstSpeaker: "agent",
  },
  outbound_followup: {
    label: "Outbound Follow-up",
    description: "AI calls a lead back — user speaks first",
    callType: "outbound_followup",
    firstSpeaker: "user",
  },
  speed_to_lead: {
    label: "Speed to Lead",
    description: "AI calls a new lead — user speaks first",
    callType: "speed_to_lead",
    firstSpeaker: "user",
  },
};

export interface Preset {
  name: string;
  group: string;
  variables: Record<string, string>;
}

const SLOTS_PHONE =
  "Friday, May 30th: 10 in the morning, 11 in the morning, 12 in the afternoon, 1 in the afternoon, 2 in the afternoon, 5 in the evening\nSaturday, May 31st: 8 in the morning, 9 in the morning, 10 in the morning, 11 in the morning, 12 in the afternoon, 1 in the afternoon\nMonday, June 2nd: 10 in the morning, 11 in the morning, 12 in the afternoon, 1 in the afternoon, 2 in the afternoon, 5 in the evening\nTuesday, June 3rd: 10 in the morning, 11 in the morning, 12 in the afternoon, 1 in the afternoon, 2 in the afternoon";

const SLOTS_IN_PERSON =
  "Friday, May 30th: 10 in the morning, 11 in the morning, 1 in the afternoon, 3 in the afternoon\nSaturday, May 31st: 9 in the morning, 10 in the morning, 11 in the morning, 1 in the afternoon\nMonday, June 2nd: 10 in the morning, 11 in the morning, 1 in the afternoon, 3 in the afternoon\nTuesday, June 3rd: 10 in the morning, 1 in the afternoon, 3 in the afternoon";

const BASE: Record<string, string> = {
  lead_id: "",
  Agent_Name: "Emily",
  has_context: "false",
  price_value: "",
  zip_in_area: "true",
  business_zip: "70112",
  company_name: "504 Home Buyers",
  price_status: "unknown",
  property_zip: "70118",
  reason_value: "",
  acreage_value: "",
  business_city: "New Orleans",
  greeting_mode: "default",
  property_type: "residential",
  reason_status: "unknown",
  business_state: "LA",
  mortgage_value: "",
  next_step_type: "phone_appointment",
  phone_rep_name: "Marcus",
  timeline_value: "",
  today_date_iso: new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
  condition_value: "",
  mortgage_status: "unknown",
  occupancy_value: "",
  timeline_status: "unknown",
  booking_link_url: "",
  condition_status: "unknown",
  occupancy_status: "unknown",
  last_call_summary: "",
  offer_source_used: "",
  road_access_value: "",
  alternatives_value: "",
  in_person_rep_name: "Marcus",
  offer_range_spoken: "",
  land_type_use_value: "",
  appointment_timezone: "America/Chicago",
  out_of_area_behavior: "",
  callback_ask_for_time: "",
  decision_makers_value: "",
  dynamic_offer_enabled: "false",
  parcel_location_value: "",
  property_address_full: "",
  transfer_phone_number: "",
  custom_greeting_script: "",
  decision_makers_status: "unknown",
  utilities_access_value: "",
  interested_primary_action: "phone_appointment",
  property_address_stripped: "",
  upcoming_appointment_date: "",
  upcoming_appointment_time: "",
  upcoming_appointment_type: "",
  conversation_recency_bucket: "",
  deal_killers_concerns_value: "",
  phone_appointment_slots_spoken: SLOTS_PHONE,
  in_person_appointment_slots_spoken: SLOTS_IN_PERSON,
  lead_qualification_res_selected_csv:
    "confirmAddress,motivation,timeline,alternatives,condition,priceExpectation,occupancy,mortgageLiens,decisionMakers,dealKillers",
  lead_qualification_land_selected_csv: "",
  lead_qualification_property_type_focus: "residential",
  lead_qualification_auto_confirm_property_type: "true",
  last_offer_amount: "",
  last_offer_date: "",
  offer_already_delivered: "false",
  pushback_count: "0",
  company_website: "504homebuyers.com",
  seller_first_name: "",
};

function preset(
  name: string,
  group: string,
  overrides: Record<string, string>
): Preset {
  return { name, group, variables: { ...BASE, ...overrides } };
}

// Helper: all residential discovery fields marked Fresh
const ALL_FRESH: Record<string, string> = {
  occupancy_status: "Fresh",
  occupancy_value: "vacant",
  condition_status: "Fresh",
  condition_value: "needs cosmetic work",
  timeline_status: "Fresh",
  timeline_value: "30 days",
  reason_status: "Fresh",
  reason_value: "downsizing",
  price_status: "Fresh",
  price_value: "180000",
  mortgage_status: "Fresh",
  mortgage_value: "free and clear",
  decision_makers_status: "Fresh",
  decision_makers_value: "sole owner",
  deal_killers_concerns_value: "none",
  alternatives_value: "not interested in listing",
};

export const VARIABLE_PRESETS: Preset[] = [
  // ═══════════════════════════════════════════════════════════
  // INBOUND
  // ═══════════════════════════════════════════════════════════

  // MASTER ROUTER → inbound_default → Default Opener
  // Logic Split → else → Two-Minute Ask → Address Capture → full discovery → phone sched
  preset("IB — Fresh (Default Opener)", "Inbound", {
    has_context: "false",
    property_address_full: "",
    property_address_stripped: "",
    greeting_mode: "default",
  }),

  // MASTER ROUTER → inbound_custom → Custom Opener
  // (human-recorded and human-no-disclosure also route here)
  preset("IB — Fresh (Custom Opener)", "Inbound", {
    has_context: "false",
    greeting_mode: "custom",
    custom_greeting_script:
      "Hi, this is Sarah with 504 Home Buyers on a recorded line, how can I help you today?",
  }),

  // Logic Split → addr exists + has_context → Returning With Address
  // Discovery Router → all Fresh → skip → Gate Router → skip (deal_killers="none") → Exit Router → phone
  preset("IB — Returning, All Fresh", "Inbound", {
    has_context: "true",
    property_address_full: "456 Pine Street, Metairie, LA 70005",
    property_address_stripped: "456 Pine Street, Metairie, LA 70005",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Seller called about Pine St. Owner-occupied, cosmetic work needed, wants 30 days. Downsizing. No mortgage. Sole owner. Thinking 180k.",
  }),

  // Discovery Router → first unknown field (condition) → partial discovery → Gate Router → ask
  preset("IB — Returning, Some Stale", "Inbound", {
    has_context: "true",
    property_address_full: "789 Elm Ave, Kenner, LA 70062",
    property_address_stripped: "789 Elm Ave, Kenner, LA 70062",
    occupancy_status: "Fresh",
    occupancy_value: "vacant",
    condition_status: "unknown",
    timeline_status: "unknown",
    reason_status: "Fresh",
    reason_value: "inherited",
    price_status: "Fresh",
    price_value: "120000",
    mortgage_status: "Fresh",
    mortgage_value: "free and clear",
    decision_makers_status: "Fresh",
    decision_makers_value: "sole owner",
    conversation_recency_bucket: "8-30",
    last_call_summary:
      "Inherited property on Elm Ave. Vacant. Free and clear. Thinking 120k. Condition and timeline not discussed.",
  }),

  // Logic Split → no addr + has_context → Address Capture (with "I don't have an address on file" prompt)
  preset("IB — Returning, No Address", "Inbound", {
    has_context: "true",
    property_address_full: "",
    property_address_stripped: "",
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Spoke recently but address was never captured.",
  }),

  // Logic Split → missed-call language (prompt) → Missed Call Fresh (address branch)
  preset("IB — Missed Call, Has Address", "Inbound", {
    has_context: "true",
    property_address_full: "321 Maple Drive, Gretna, LA 70056",
    property_address_stripped: "321 Maple Drive, Gretna, LA 70056",
    conversation_recency_bucket: "1-7",
  }),

  // Missed Call Fresh → no address → "We buy homes directly from owners in the area"
  preset("IB — Missed Call, No Address", "Inbound", {
    has_context: "false",
    property_address_full: "",
    property_address_stripped: "",
  }),

  // Appt Router → has_appt (future date) → Appt Check convo
  preset("IB — Future Appointment", "Inbound", {
    has_context: "true",
    property_address_full: "678 Prytania St, New Orleans, LA 70130",
    property_address_stripped: "678 Prytania St, New Orleans, LA 70130",
    upcoming_appointment_date: "2026-06-02",
    upcoming_appointment_time: "14:00",
    upcoming_appointment_type: "phone",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Has phone appointment Monday June 2nd at 2pm. Fully qualified.",
  }),

  // Appt Router → no_appt (past date) → Intent Check
  preset("IB — Past Appointment", "Inbound", {
    has_context: "true",
    property_address_full: "222 Dauphine St, New Orleans, LA 70116",
    property_address_stripped: "222 Dauphine St, New Orleans, LA 70116",
    upcoming_appointment_date: "2026-05-14",
    upcoming_appointment_time: "10:00",
    upcoming_appointment_type: "phone",
    occupancy_status: "Fresh",
    occupancy_value: "owner-occupied",
    conversation_recency_bucket: "8-30",
    last_call_summary:
      "Had phone appointment May 14th at 10am that already passed.",
  }),

  // Exit Router → next_step=offer_conversation → Offer node (offer_range present)
  // NOTE: next_step must be "offer_conversation" to reach Offer; "phone_appointment" bypasses it
  preset("IB — Offer Flow", "Inbound", {
    has_context: "true",
    property_address_full: "200 Bourbon Street, New Orleans, LA 70130",
    property_address_stripped: "200 Bourbon Street, New Orleans, LA 70130",
    next_step_type: "offer_conversation",
    dynamic_offer_enabled: "true",
    offer_source_used: "ev_basis",
    offer_range_spoken:
      "one hundred fifty thousand to one hundred seventy thousand",
    offer_already_delivered: "false",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Returning caller on Bourbon St. Fully qualified. Offer range ready: 150-170k.",
  }),

  // Exit Router → next_step=in_person_walkthrough → In-Person Scheduling
  preset("IB — In-Person Scheduling", "Inbound", {
    has_context: "true",
    property_address_full: "901 St Charles Ave, New Orleans, LA 70130",
    property_address_stripped: "901 St Charles Ave, New Orleans, LA 70130",
    next_step_type: "in_person_walkthrough",
    interested_primary_action: "in_person_walkthrough",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Fully qualified on St Charles Ave. Ready for in-person walkthrough.",
  }),

  // Exit Router → next_step=callback → Callback Capture (ask for time)
  preset("IB — Callback", "Inbound", {
    has_context: "true",
    property_address_full: "901 St Charles Ave, New Orleans, LA 70130",
    property_address_stripped: "901 St Charles Ave, New Orleans, LA 70130",
    next_step_type: "callback",
    callback_ask_for_time: "true",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary: "Qualified lead. Routing to callback.",
  }),

  // Exit Router → next_step=send_booking_link → Callback Capture (booking link variant)
  preset("IB — Booking Link", "Inbound", {
    has_context: "true",
    property_address_full: "901 St Charles Ave, New Orleans, LA 70130",
    property_address_stripped: "901 St Charles Ave, New Orleans, LA 70130",
    next_step_type: "send_booking_link",
    booking_link_url: "https://calendly.com/504homebuyers/call",
    ...ALL_FRESH,
    conversation_recency_bucket: "1-7",
    last_call_summary: "Qualified lead. Sending booking link.",
  }),

  // zip_in_area=false → Out of Area handling
  preset("IB — Out of Area", "Inbound", {
    has_context: "false",
    zip_in_area: "false",
    property_zip: "90210",
    property_address_full: "123 Beverly Dr, Beverly Hills, CA 90210",
    property_address_stripped: "123 Beverly Dr, Beverly Hills, CA 90210",
  }),

  // property_type=land → different qualification CSV, land-specific discovery fields
  preset("IB — Land Property", "Inbound", {
    has_context: "false",
    property_type: "land",
    lead_qualification_property_type_focus: "land",
    lead_qualification_res_selected_csv: "",
    lead_qualification_land_selected_csv:
      "parcel_location,parcel_size_acreage,land_type_use,road_access_utilities,timeline,motivation,zoning_use,price_expectation,mortgage_liens,decision_makers",
    lead_qualification_auto_confirm_property_type: "false",
  }),

  // ═══════════════════════════════════════════════════════════
  // OUTBOUND FOLLOW-UP
  // ═══════════════════════════════════════════════════════════

  // MASTER ROUTER → outbound_default → Outbound Default Opener (recent tier)
  preset("OB — Recent Followup", "Outbound", {
    has_context: "true",
    property_address_full: "350 Royal Street, New Orleans, LA 70130",
    property_address_stripped: "350 Royal Street, New Orleans, LA 70130",
    occupancy_status: "Fresh",
    occupancy_value: "vacant",
    condition_status: "unknown",
    conversation_recency_bucket: "1-7",
    last_call_summary:
      "Spoke 3 days ago about Royal St. Vacant property. Condition not discussed.",
    greeting_mode: "default",
  }),

  // Outbound Default Opener → long gap tier (different opening language)
  preset("OB — Long Gap", "Outbound", {
    has_context: "true",
    property_address_full: "888 Canal Street, New Orleans, LA 70112",
    property_address_stripped: "888 Canal Street, New Orleans, LA 70112",
    occupancy_status: "Fresh",
    occupancy_value: "owner-occupied",
    condition_status: "Fresh",
    condition_value: "fair",
    conversation_recency_bucket: "31+",
    last_call_summary:
      "Last spoke over a month ago about Canal St. Owner-occupied, fair condition. On the fence.",
    greeting_mode: "default",
  }),

  // MASTER ROUTER → outbound_custom → Outbound Custom Opener
  preset("OB — Custom Opener", "Outbound", {
    has_context: "true",
    property_address_full: "350 Royal Street, New Orleans, LA 70130",
    property_address_stripped: "350 Royal Street, New Orleans, LA 70130",
    conversation_recency_bucket: "1-7",
    last_call_summary: "Recent followup on Royal St.",
    greeting_mode: "custom",
    custom_greeting_script:
      "Hey, this is Sarah with 504 Home Buyers. I'm circling back about the property on Royal Street — do you have a quick minute?",
  }),

  // ═══════════════════════════════════════════════════════════
  // SPEED TO LEAD
  // ═══════════════════════════════════════════════════════════

  // MASTER ROUTER → stl_default → STL Default Opener
  preset("STL — Default", "Speed to Lead", {
    has_context: "true",
    property_address_full: "555 Canal Street, New Orleans, LA 70130",
    property_address_stripped: "555 Canal Street, New Orleans, LA 70130",
    greeting_mode: "default",
  }),

  // MASTER ROUTER → stl_custom → STL Custom Opener
  preset("STL — Custom", "Speed to Lead", {
    has_context: "true",
    property_address_full: "555 Canal Street, New Orleans, LA 70130",
    property_address_stripped: "555 Canal Street, New Orleans, LA 70130",
    greeting_mode: "custom",
    custom_greeting_script:
      "Hey, this is Sarah with 504 Home Buyers. We just got your info on the property at Canal Street — wanted to reach out real quick while it's fresh.",
  }),
];
