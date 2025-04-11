// SOURCE: https://github.com/qoomon/GoogleContactsEventsToGoogleCalendarSync
// Version: 1.0.4
// Author: qoomon

// # INSTRUCTION Initial setup...
// 1) Add People and Calendar service by clicking on the "+"" icon next to "Services" at the left pannel.

// # INSTRUCTION Sync birthdays and special events from your Google Contacts into any Google Calendar...
// 1) Adjust the "ContactsEventLocalization" and the "Config" below before you proceed.
// 2) Click "Save project to Drive" above afterwards
// 3) Run this script for the first time...
//   1) Select "run_syncEvents" in the dropdown menu above, then click "Run"
//   2) Click "Advanced" during warnings to proceed and grant permissions to this script to access your contacts and calanders.
// 4) Create a "Trigger" to run "syncEvents" daily...
//   1) Click "Triggers" in the most left pannel
//   2) Click "Add Trigger" Button at the bottom right
//   3) Select "run_syncEvents" for "Choose which function to run"
//   3) Select "Day Timer" for "Select type of time based trigger"
//   4) Click "Save" Button

// # INSTRUCTION Remove all synced events...
// 1) Select "run_removeEvents" in the dropdown menu above, then click "Run"

const ContactsEventLocalization = { 
  birthday: "Birthday", anniversary: "Anniversary", ordinalFormat: ordinalFormat_en, // en
  // birthday: "Geburtstag", anniversary: "Jahrestag", ordinalFormat: ordinalFormat_de, // de
};

const Config = {
  // --- Google Contacts ---
  contacts: {
    // If undefined all contacts are synced
    // If set only contacts with that label are synced
    //   To get the contactsLabelId...
    //   - Open https://contacts.google.com/
    //   - Click on any contact label on the left pannel,
    //     the last part of the url address is the contactsLabelId (https://contacts.google.com/label/[contactsLabelId]?...)
    labelId: "CHANGE_ME",
    // If not empty, only sync those contact event types/labels
    annualEventTypes: [
      // ContactsEventLocalization.birthday,
      // ContactsEventLocalization.anniversary,
      // YOUR CUSTOM ANUAL EVENT LABELS
    ],
  },
  // --- Google Calendar ---
  calendar: {
    // Target calendar for contact events. Set to "primary" for the default calendar.
    //   To get the calendarId for a calendar...
    //   - Open https://calendar.google.com/
    //   - Hover over any of your calenders you have write premissions
    //   - Click on the 3 dot menu and then click on "Settings and sharing"
    //   - Sroll down to "Integrate calendar" > "Calendar ID"
    id: "CHANGE_ME@group.calendar.google.com",
    eventSummaryPrefix: "⌘ ", // ⌘, ❖, ✱, 
  },
};

// --- main methods START ---

const CALENDAR_CONTACTS_EVENTS_SOURCE = "contacts";

function run_debug(event) {
  console.log("Google Contacts group:", People.ContactGroups.get(`contactGroups/${Config.contacts.labelId}`)?.formattedName);
  console.log("Google Calendar:", Calendar.Calendars.get(Config.calendar.id)?.summary);
}

function run_syncEvents() {
  try {
    const calendarName = Calendar.Calendars.get(Config.calendar.id).summary;
    if(Config.contacts.labelId) {
      const contactGroupName = People.ContactGroups.get(`contactGroups/${Config.contacts.labelId}`).formattedName;
      console.info(`Sync contacts events from contacts group '${contactGroupName}' to Google Calendar '${calendarName}'`);
    } else {
      console.info(`Sync ALL contacts events to Google Calendar '${calendarName}'`);
    }
    
    const contactsEvents = getContactsEvents({
      types: Config.contacts.annualEventTypes,
      labelId: Config.contacts.labelId,
    });
    console.info("Contacts events: " + contactsEvents.length);

    const calendarContactsEvents = getCalendarContactsEvents({
      calendarId: Config.calendar.id,
    });
    console.info("Calendar contacts events: " + calendarContactsEvents.length);

    // --- remove calendar events ---
    const contactsEventIdSet = new Set(contactsEvents.map((event) => event.id));
    const calendarContactsEventsMap = Object.fromEntries(calendarContactsEvents.map((event) => [event.id, event]));
    calendarContactsEvents.forEach((event) => {
      if(event.recurringEventId) {
        const recurringEvent = calendarContactsEventsMap[event.recurringEventId];
        if(recurringEvent) {
          console.log("Remove calendar event because it has been modified manually");
          removeCalendarEvent(Config.calendar.id, recurringEvent);
          delete calendarContactsEventsMap[event.recurringEventId]
          delete calendarContactsEventsMap[event.id]
        }
      } else if(!contactsEventIdSet.has(event.extendedProperties.private.contactEventId)) {
        console.log("Remove calendar event because contact event has been deleted");
        removeCalendarEvent(Config.calendar.id, event);
        delete calendarContactsEventsMap[event.id]
      }
    });

    // --- create or update calendar events ---
    contactsEvents.forEach((contactEvent) => {
      createOrUpdateCalendarEventFromContactEvent(Config.calendar.id, contactEvent);
    });
  } catch (error) {
    console.error("ERROR", error.stack);
  }
}

function run_removeEvents() {
  try {
    const calendarName = Calendar.Calendars.get(Config.calendar.id).summary;
    console.info(`Remove all contacts events from Google Calendar '${calendarName}'`);

    const calendarContactsEvents = getCalendarContactsEvents({
      calendarId: Config.calendar.id,
    }).filter((event) => event.status === 'confirmed');
    console.info("Calendar contacts events count: " + calendarContactsEvents.length);

    calendarContactsEvents.forEach((event) => {
      removeCalendarEvent(Config.calendar.id, event);
    });
  } catch (error) {
    console.error("ERROR", error.stack);
  }
}

// --- main methods END ---

function getCalendarContactsEvents({ calendarId, privateExtendedProperties }) {
  const result = [];

  let nextPageToken = null;
  do {
    const response = Calendar.Events.list(calendarId, {
      privateExtendedProperty: Object.entries(Object.assign({
          source: CALENDAR_CONTACTS_EVENTS_SOURCE,
        }, privateExtendedProperties ?? {}))
        .map(([key, value]) => `${key}=${value}`),
      pageToken: nextPageToken,
    });

    nextPageToken = response.nextPageToken;

    result.push(...response.items);
  } while (nextPageToken);

  return result;
}

function getContactsConections({ labelId }) {
  const result = [];

  let nextPageToken = null;
  do {
    const response = People.People.Connections.list("people/me", {
      personFields: "names,birthdays,events,memberships",
      pageToken: nextPageToken,
    });
    nextPageToken = response.nextPageToken;

    const connections = labelId
      ? response.connections?.filter((connection) =>
          connection.memberships?.some((membership) => membership.contactGroupMembership?.contactGroupId === labelId))
      : response.connections;
    result.push(...connections);
  } while (nextPageToken);

  return result;
}

function getContactsEvents({ labelId, types }) {
  types = types.map((type) => type.toLowerCase());
  return getContactsConections({ labelId })
    .flatMap(getContactEvents)
    .filter((event) => types.length === 0 || types.includes(event.type.toLowerCase()));
}

function getContactEvents(connection) {
  const contact = {
    resourceName: connection.resourceName,
    name: connection.names?.[0].displayName,
  };
  if (!contact.name) {
    console.warn("Skip connection without name");
    return [];
  }

  const contactEventTypes = new Set();
  const events = [];

  const birthday = connection.birthdays?.[0];
  if (birthday) {
    if(connection.birthdays?.length > 1){
      console.warn(`Ambigous birthday from ${contact.name}`);
    }
  
    if (!birthday.date){
      console.warn(`Skip birthday without date from ${contact.name}`);
    } else {
      events.push({
        type: ContactsEventLocalization.birthday,
        date: birthday.date,
      });
    }
  }

  // Special Events
  connection.events?.forEach((connectionEvent) => {
    const eventLabel = connectionEvent.formattedType;
    if (!eventLabel) {
      console.warn(`Skip event without label from ${contact.name}`);
      return;
    }

    if(contactEventTypes.has(eventLabel)) {
      console.warn(`Skip ambigous ${eventLabel} from ${contact.name}`);
      return;
    }
    contactEventTypes.add(eventLabel);

    if (!connectionEvent.date){
      console.warn(`Skip ${eventLabel} without date from ${contact.name}`);
    } else {
      events.push({
        type: eventLabel,
        date: connectionEvent.date,
      } );
    }
  });

  // enrich event
  events.forEach((event) => {
    event.contact = contact;
    event.id = buildContactEventId(event.type, event.contact.resourceName);

    event.summary = `${event.contact.name}'s ${event.type}`;
    if (event.date.year) {
      const currentYear = new Date().getFullYear();
      const age = currentYear - event.date.year;
      event.summary += ` (${ContactsEventLocalization.formatOrdinal(age)})`;
    }
  });

  return events;

  function buildContactEventId(type, resourceName) {
    const value = `${resourceName}-${type}`;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
    return Utilities.base64EncodeWebSafe(digest).replace(/=+$/,"");
  }
}

function createOrUpdateCalendarEventFromContactEvent(calendarId, contactEvent) {
  // NOTE as of now (2025-01-01) there is no way to determine the creation date of the contact, therefore we use 1970 as the event start date
  const contactEventDate = new Date([
    contactEvent.date.year ?? 1970,
    String(contactEvent.date.month).padStart(2, "0"),
    String(contactEvent.date.day).padStart(2, "0"),
  ].join("-"));

  const calendarEvent = {
    eventType: "default",
    summary: `${Config.calendar.eventSummaryPrefix ?? "" }${contactEvent.summary}`,
    start: { date: contactEventDate.toISOString().split("T")[0] },
    end: { date: nextDay(contactEventDate).toISOString().split("T")[0] },
    recurrence: [(contactEvent.date.month === 2 && contactEvent.date.day === 29)
      ? "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1" // Exception for Feb 29th!
      : "RRULE:FREQ=YEARLY"],
    description: `<a href="https://contacts.google.com/person/${contactEvent.contact.resourceName.replace(/^people\//,'')}"><b>Google Contacts</b></a>`,
    transparency: "transparent", // The event does not block time on the calendar.
    visibility: "private",
    extendedProperties: {
      private: {
        source: CALENDAR_CONTACTS_EVENTS_SOURCE,
        contactEventId: contactEvent.id,
      }
    }
  };

  const existingEvents = getCalendarContactsEvents({
    calendarId,
    privateExtendedProperties: {
      contactEventId: contactEvent.id,
    },
  });
  if(existingEvents.length > 1) {
    throw new Error(`Ambiguous ${contactEvent.type} from ${contactEvent.contact.name} on ${contactEventDate.toISOString().split("T")[0]}`);
  }

  const existingEvent = existingEvents[0];
  if (!existingEvent) {
    console.info(`Create ${contactEvent.type} from ${contactEvent.contact.name} on ${contactEventDate.toISOString().split("T")[0]}`);
    Calendar.Events.insert(calendarEvent, calendarId);
  } else {
    const eventHasUpdates = calendarEvent.summary !== existingEvent.summary ||
      calendarEvent.start.date !== existingEvent.start.date ||
      calendarEvent.end.date !== existingEvent.end.date ||
      calendarEvent.recurrence[0] !== existingEvent.recurrence[0] ||
      calendarEvent.description !== existingEvent.description;
    if(eventHasUpdates) {
      console.info(`Update ${contactEvent.type} from ${contactEvent.contact.name} on ${contactEventDate.toISOString().split("T")[0]}`);
      Calendar.Events.update(calendarEvent, calendarId, existingEvent.id);
    } else {
      console.log(`No changes for ${contactEvent.type} from ${contactEvent.contact.name} on ${contactEventDate.toISOString().split("T")[0]}`);
    }
  }
}

function removeCalendarEvent(calendarId, event) {
  console.info(`Remove '${event.summary}' on ${event.start?.date}`);
  Calendar.Events.remove(calendarId, event.id);
}

function nextDay(date) {
  const nextDayDate = new Date(date);
  nextDayDate.setDate(date.getDate() + 1);
  return nextDayDate;
}

function ordinalFormat_de(n) { 
  return `${n}.`
}

function ordinalFormat_en(n) {
  const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });
  const suffixes = {
    one: "st",
    two: "nd",
    few: "rd",
    other: "th",
  }
  const rule = ordinalRules.select(n);
  return `${n}${suffixes[rule]}`;
}
