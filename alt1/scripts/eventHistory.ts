import { UUIDTypes } from "uuid";
import { EventRecord, EventKeys, events, eventTimes } from "./events";
import { wsClient } from "./ws";
import { DEBUG } from "../config";
import { userHasRequiredRole } from "./permissions";
import { showToast } from "./notifications";
import { updateWorld } from "./mistyTimers";

export let eventHistory: EventRecord[] = [];
export let expiredEvents: EventRecord[] = [];
export const rowMap = new Map<UUIDTypes, HTMLTableRowElement>();

// Local refresh interval for timer updates.
let refreshInterval: NodeJS.Timeout | null = null;

type SpecialWorld = {
    world: number;
    reason: string;
    imageSrc: string;
};

export const MEMBER_WORLDS = [
    "1",
    "2",
    "4",
    "5",
    "6",
    "9",
    "10",
    "12",
    "14",
    "15",
    "16",
    "18",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "30",
    "31",
    "32",
    "35",
    "36",
    "37",
    "39",
    "40",
    "42",
    "44",
    "45",
    "46",
    "48",
    "49",
    "50",
    "51",
    "52",
    "53",
    "54",
    "56",
    "58",
    "59",
    "60",
    "62",
    "63",
    "64",
    "65",
    "66",
    "67",
    "68",
    "69",
    "70",
    "71",
    "72",
    "73",
    "74",
    "76",
    "77",
    "78",
    "79",
    "82",
    "83",
    "84",
    "85",
    "86",
    "87",
    "88",
    "89",
    "91",
    "92",
    "96",
    "97",
    "98",
    "99",
    "100",
    "103",
    "104",
    "105",
    "106",
    "114",
    "115",
    "116",
    "117",
    "119",
    "123",
    "124",
    "134",
    "137",
    "138",
    "139",
    "140",
    "252",
    "257",
    "258",
    "259",
];

const WorldActivity: Record<string, string> = {
    legacy: "./assets/world_activity/legacy.png",
    vip: "./assets/world_activity/vip_badge.png",
    quickChat: "./assets/world_activity/quick_chat.png",
    eoc: "./assets/world_activity/revolution.png",
    fifteenPlus: "./assets/world_activity/1500.png",
    twentyPlus: "./assets/world_activity/2000.png",
    twentySixPlus: "./assets/world_activity/2600.png",
    laggy: "./assets/world_activity/lag.png",
    dsf: "./assets/world_activity/dsf.png",
    sixtyNine: "./assets/world_activity/nice.png",
};

const rawSpecialWorlds: { world: number; key: string }[] = [
    { world: 18, key: "legacy" },
    { world: 30, key: "twentyPlus" },
    { world: 48, key: "twentySixPlus" },
    { world: 52, key: "vip" },
    { world: 66, key: "eoc" },
    { world: 84, key: "laggy" },
    { world: 86, key: "fifteenPlus" },
    { world: 96, key: "quickChat" },
    { world: 114, key: "fifteenPlus" },
    { world: 115, key: "legacy" },
    { world: 116, key: "dsf" },
    { world: 137, key: "legacy" },
    { world: 69, key: "sixtyNine" },
];

const SPECIAL_WORLDS: SpecialWorld[] = rawSpecialWorlds.map(({ world, key }) => ({
    world,
    reason: key,
    imageSrc: WorldActivity[key],
}));

export function getSpecialWorld(world: string): SpecialWorld | null {
    return SPECIAL_WORLDS.find((item) => item.world.toString() === world) ?? null;
}

/**
 * Updates one or more cells in a table row.
 *
 * @param row - The HTMLTableRowElement to update.
 * @param updates - An array of update objects, each specifying:
 *    - cellIndex: the index of the cell to update,
 *    - newContent (optional): the new text content for the cell,
 *    - newClass (optional): a new class name to assign,
 *    - newStyle (optional): an object containing CSS properties and values to assign.
 */
export function updateTableRowCells(
    row: HTMLTableRowElement,
    updates: {
        cellIndex: number;
        newContent: string;
        newClass?: string;
        newStyle?: Partial<CSSStyleDeclaration>;
    }[],
): void {
    updates.forEach((update) => {
        const cell = row.cells[update.cellIndex];
        if (!cell) return;

        if ([1, 2].includes(update.cellIndex)) {
            cell.textContent = update.newContent;
            if (update.newClass !== undefined) {
                cell.className = update.newClass;
            }
            if (update.newStyle !== undefined) {
                Object.assign(cell.style, update.newStyle);
            }
        }

        if (update.cellIndex === 3) {
            const toggleMistyTimer = document.getElementById("toggleMistyTimer") as HTMLInputElement | null;
            if (!toggleMistyTimer) return;
            const mistyTimer = toggleMistyTimer.checked;

            updateTimer(row, update, mistyTimer);
        }

        if (update.cellIndex === 4) {
            // Special handling for the reportedBy cell.
            // Check for an existing icon.
            let icon = cell.querySelector("img");
            if (!icon) {
                icon = document.createElement("img");
                icon.style.marginRight = "5px"; // Adjust spacing as needed.
                icon.src = "./assets/Alt1_icon.png";
                icon.alt = "Alt1";
                if (update.newContent === "discord") {
                    icon.src = "./assets/Discord_icon.png";
                    icon.alt = "Discord";
                }
                // Insert the icon at the beginning of the cell.
                cell.insertBefore(icon, cell.firstChild);
            } else {
                // Now update the RSN text in a span.
                let textSpan = cell.querySelector("span.reported-by-text");
                if (!textSpan) {
                    textSpan = document.createElement("span");
                    textSpan.className = "reported-by-text";
                    cell.appendChild(textSpan);
                }
                textSpan.textContent = update.newContent || "Unknown";
            }
        }
    });
}

export function updateHideExpiredRows(): void {
    const hideExpiredCheckbox = document.getElementById("hideExpiredCheckbox") as HTMLInputElement | null;
    if (!hideExpiredCheckbox) return;
    const hideExpired = hideExpiredCheckbox.checked;
    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;

    // Iterate over each row in the event history table.
    const rows = Array.from(tbody.getElementsByTagName("tr"));
    for (const row of rows) {
        const cells = row.getElementsByTagName("td");
        const timeLeftText = cells[3].textContent?.trim() || "";
        if (hideExpired && timeLeftText === "Expired") {
            row.style.display = "none";
        } else {
            row.style.display = "";
        }
    }
}

function updateTimer(
    row: HTMLTableRowElement,
    update: { cellIndex: number; newContent: string },
    mistyChecked: boolean = false,
): void {
    const cells = row.getElementsByTagName("td");
    const eventName = (cells[1].textContent?.trim() || "Unknown") as EventKeys;
    const maxDuration = eventTimes[eventName];

    if (mistyChecked) {
        // Count up
        let elapsed: number;
        if (["Expired", "Event starting"].includes(update.newContent)) {
            cells[3].textContent = update.newContent;
            return;
        } else {
            elapsed = parseDuration(update.newContent);
        }

        cells[3].textContent = elapsed >= maxDuration ? "Expired" : formatTimeLeftValue(elapsed);
    } else {
        // Count down
        cells[3].textContent = update.newContent;
    }
}

const sortPinnedEvents = (activeEvents: EventRecord[], favouriteEvents: EventKeys[]): EventRecord[] => {
    return activeEvents.sort((x, y) => {
        const xPriority = favouriteEvents.includes(x.event);
        const yPriority = favouriteEvents.includes(y.event);

        if (xPriority && yPriority) return 0; // Keep relative order of priority elements
        if (xPriority) return 1; // Move x to the end
        if (yPriority) return -1; // Move y to the end
        return 0; // Keep original order otherwise
    });
};

export function renderEventHistory(): void {
    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    const now = Date.now();
    const savedFavourites = localStorage.getItem("favoriteEvents");
    const favouriteEvents = savedFavourites ? (JSON.parse(savedFavourites) as EventKeys[]) : [];

    const favMode = localStorage.getItem("favoriteEventsMode") || "none";

    let eventsToRender = eventHistory.slice();
    if (favMode === "only") {
        eventsToRender = eventsToRender.filter((event) => favouriteEvents.includes(event.event));
    }

    let activeEvents: EventRecord[] = [];
    eventsToRender.forEach((event) => {
        const elapsed = (now - event.timestamp) / 1000;
        const remaining = event.duration - elapsed;
        if (remaining > 0) {
            activeEvents.push(event);
        } else {
            const exists = expiredEvents.some((e) => e.id === event.id);
            if (!exists) {
                expiredEvents.push(event);
            }
        }
    });

    if (favMode === "pin") {
        activeEvents = sortPinnedEvents(activeEvents, favouriteEvents);
    }

    // On initial render, sort active events to the top of the table
    let sortedEvents = [...expiredEvents, ...activeEvents];
    if (favMode === "only") {
        sortedEvents = sortedEvents.filter((event) => favouriteEvents.includes(event.event));
    }

    const hideExpiredCheckbox = document.getElementById("hideExpiredCheckbox") as HTMLInputElement | null;
    const hideExpired = hideExpiredCheckbox ? hideExpiredCheckbox.checked : false;

    sortedEvents.forEach((event) => {
        const elapsed = (now - event.timestamp) / 1000;
        let remaining = event.duration - elapsed;
        if (remaining < 0) remaining = 0;

        if (hideExpired && remaining === 0) return;
        const isFavourite = favouriteEvents.includes(event.event);
        const shouldHighlight = favMode === "highlight" && isFavourite;
        const pin = favMode === "pin" && isFavourite;
        appendEventRow(event, shouldHighlight, pin);
    });
}

export function loadEventHistory(): void {
    const stored = localStorage.getItem("eventHistory");
    if (stored) {
        try {
            eventHistory = JSON.parse(stored);
            renderEventHistory();
        } catch (e) {
            console.error("Error parsing eventHistory from localStorage", e);
            eventHistory = [];
        }
    }
}

export function saveEventHistory(): void {
    localStorage.setItem("eventHistory", JSON.stringify(eventHistory));
}

export function clearEventHistory(): void {
    eventHistory = [];
    expiredEvents = [];
    rowMap.clear();
    saveEventHistory();

    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;
    tbody.innerHTML = "";
}

export function addNewEvent(newEvent: EventRecord): void {
    if (eventHistory.some((event) => event.id === newEvent.id)) {
        console.log("Skipping duplicate event: ", newEvent.id);
        return;
    }
    eventHistory.push(newEvent);
    saveEventHistory();

    const favMode = localStorage.getItem("favoriteEventsMode") || "none";
    const savedFavourites = localStorage.getItem("favoriteEvents");
    const favouriteEvents = savedFavourites ? (JSON.parse(savedFavourites) as string[]) : [];

    if (favMode === "only" && !favouriteEvents.includes(newEvent.event)) {
        return;
    }

    // Append a new row for the event.
    appendEventRow(
        newEvent,
        favMode === "highlight" && favouriteEvents.includes(newEvent.event),
        favMode === "pin" && favouriteEvents.includes(newEvent.event),
    );
    restartRefreshInterval();
}

let eventNotFound = true;
export function updateEvent(event: EventRecord): void {
    const idx = eventHistory.findIndex((e) => checkActive(e) && e.id === event.id);
    if (idx !== -1) {
        eventHistory[idx] = event; // Update the event in the history.
        saveEventHistory(); // Save the updated event history.

        // Update the row in the event history table.
        const row = rowMap.get(event.id);
        if (row) {
            updateTableRowCells(row, [
                { cellIndex: 1, newContent: event.event },
                { cellIndex: 2, newContent: event.world },
                { cellIndex: 3, newContent: formatTimeLeft(event) },
                { cellIndex: 4, newContent: event.source },
                { cellIndex: 4, newContent: event.reportedBy },
            ]);
        }
        restartRefreshInterval();
    } else {
        if (eventNotFound) {
            eventNotFound = false;
            addNewEvent(event.oldEvent!);
            updateEvent(event);
        }
        eventNotFound = true;
    }
}

export function updateEventTimers(): void {
    const now = Date.now();
    const mistyToggle = localStorage.getItem("toggleMistyTimer") === "true";

    eventHistory.forEach((event) => {
        const elapsed = (now - event.timestamp) / 1000;
        const maxDuration = eventTimes[event.event];
        const remaining = mistyToggle ? elapsed + (maxDuration - event.duration) : event.duration - elapsed;

        const row = rowMap.get(event.id);
        if (row) {
            if (row && row.classList.contains("editing")) return;
            updateTableRowCells(row, [{ cellIndex: 3, newContent: formatTimeLeft(event) }]);
        }

        if ((remaining < 0 && !mistyToggle) || (mistyToggle && maxDuration < remaining)) {
            const alreadyExpired = expiredEvents.some((e) => e.id === event.id);
            if (!alreadyExpired) {
                expiredEvents.push(event);
                moveExpiredEventBelowActiveEvents(event);
                if (!event.mistyUpdate) {
                    console.log(`Adding world ${event.world} to Misty tab.`);
                    updateWorld({
                        world: Number(event.world),
                        status: "Inactive",
                        last_update_timestamp: Date.now(),
                        inactive_time: 0,
                    });
                }
            }
        }
    });

    const activeEvents = eventHistory.filter(checkActive);
    if (activeEvents.length === 0 && refreshInterval) {
        stopEventTimerRefresh();
        console.log("Interval has stopped", refreshInterval);
    }
}

export function startEventTimerRefresh(): void {
    if (!refreshInterval) {
        refreshInterval = setInterval(() => {
            updateEventTimers();
        }, 1000);
    }
}

export function stopEventTimerRefresh(): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

function moveExpiredEventBelowActiveEvents(event: EventRecord): void {
    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;

    const row = rowMap.get(event.id);
    if (!row) return;

    // Find the first expired row (i.e. with "Expired" text in the time cell) among non-editing rows.
    const rows = Array.from(tbody.getElementsByTagName("tr")) as HTMLTableRowElement[];

    let firstExpiredRow: HTMLTableRowElement | null = null;
    for (const r of rows) {
        // Assume the time cell is at index 3.
        const timeText = r.cells[3]?.textContent?.trim();
        const rowId = r.getAttribute("data-id");
        if (timeText === "Expired" && rowId !== event.id) {
            firstExpiredRow = r;
            break;
        }
    }

    if (firstExpiredRow) {
        // Insert our newly expired row above the first expired row.
        tbody.insertBefore(row, firstExpiredRow);
    } else {
        // If there are no expired rows, then this row is the first expired one.
        // We need to place it after the last active event.
        // One simple way is to append it at the bottom.
        tbody.appendChild(row);
    }

    // Update the action cell (assumed to be index 0) to replace the edit button with a close button.
    const actionCell = row.cells[0];
    if (actionCell) {
        actionCell.innerHTML = ""; // Clear any existing content.

        const buttonContainer = document.createElement("div");
        buttonContainer.className = "action-buttons";

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-close";
        removeBtn.title = "Clear this event";

        const closeImg = document.createElement("img");
        closeImg.src = "./assets/close_button.png";
        closeImg.alt = "Close event";

        removeBtn.appendChild(closeImg);

        removeBtn.addEventListener("click", () => removeEvent(event));

        buttonContainer.appendChild(removeBtn);

        const modRoles = ["444972115180126228"]; // Mod role
        const hasModPermission = userHasRequiredRole(modRoles);
        if (hasModPermission) {
            const modBtn = document.createElement("button");
            modBtn.className = "btn-extra";
            modBtn.title = "Mod actions";

            const modIcon = document.createElement("img");
            modIcon.src = "./assets/rotten_potato.png"; // Add your own mod icon here (e.g., hammer, megaphone)
            modIcon.alt = "Mod actions";

            modBtn.appendChild(modIcon);

            modBtn.addEventListener("click", () => {
                // Open the modal and pass the event ID
                window.openModActionModal(event.id);
            });

            buttonContainer.appendChild(modBtn);
        }

        actionCell.appendChild(buttonContainer);
    }

    // Hide expired rows if the checkbox is checked.
    updateHideExpiredRows();
}

function restartRefreshInterval(): void {
    stopEventTimerRefresh();
    startEventTimerRefresh();
}

function appendEventRow(event: EventRecord, highlight: boolean = false, pin: boolean = false): void {
    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;

    const row = document.createElement("tr");
    if (highlight) {
        row.classList.add("favourite-event");
    }

    const remaining = getRemainingTime(event);

    const buttonsTd = document.createElement("td");
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "action-buttons";

    const allowedRoles = ["775940649802793000"]; // Scouter role
    const hasEditPermission = userHasRequiredRole(allowedRoles);
    row.dataset.id = String(event.id);

    if (remaining <= 0) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-close";
        removeBtn.title = "Clear this event";
        const closeImg = document.createElement("img");
        closeImg.src = "./assets/close_button.png";
        closeImg.alt = "Close event";
        removeBtn.appendChild(closeImg);
        removeBtn.addEventListener("click", () => removeEvent(event));
        buttonContainer.appendChild(removeBtn);
        buttonsTd.appendChild(buttonContainer);
    } else {
        if (hasEditPermission) {
            const editBtn = document.createElement("button");
            editBtn.className = "btn-extra";
            editBtn.title = "Edit event";
            const editImg = document.createElement("img");
            editImg.src = "./assets/edit_button.png";
            editImg.alt = "Edit action";
            editBtn.appendChild(editImg);
            editBtn.addEventListener("click", () => {
                const latestEvent = eventHistory.find((e) => e.id === event.id);
                if (latestEvent) {
                    editEvent(latestEvent);
                }
            });
            buttonContainer.appendChild(editBtn);
        }
    }

    const modRoles = ["444972115180126228"]; // Mod role
    const hasModPermission = userHasRequiredRole(modRoles);
    if (hasModPermission) {
        const modBtn = document.createElement("button");
        modBtn.className = "btn-extra";
        modBtn.title = "Mod actions";

        const modIcon = document.createElement("img");
        modIcon.src = "./assets/rotten_potato.png"; // Add your own mod icon here (e.g., hammer, megaphone)
        modIcon.alt = "Mod actions";

        modBtn.appendChild(modIcon);

        modBtn.addEventListener("click", () => {
            // Open the modal and pass the event ID
            window.openModActionModal(event.id);
        });

        buttonContainer.appendChild(modBtn);
    }

    buttonsTd.appendChild(buttonContainer);
    row.appendChild(buttonsTd);

    // Helper to create a cell with optional class.
    const createElement = (text: string, className?: string, element: string = "td"): HTMLElement => {
        const cell = document.createElement(element);
        cell.textContent = text;
        if (className) cell.className = className;
        return cell;
    };

    // Create cells for event, world, time left, and reportedBy.
    // event
    row.appendChild(createElement(event.event));
    // world
    const worldCell = document.createElement("td");
    const specialWorld = getSpecialWorld(event.world);
    if (specialWorld) {
        const worldIcon = document.createElement("img");
        worldIcon.style.marginRight = "5px";
        worldIcon.src = specialWorld.imageSrc;
        worldIcon.alt = specialWorld.reason;
        worldCell.appendChild(worldIcon);
    }
    worldCell.appendChild(createElement(event.world, "", "span"));
    row.appendChild(worldCell);
    // time left
    row.appendChild(createElement(formatTimeLeft(event), "time-left"));
    // reported by
    const reportedByCell = document.createElement("td");

    // Create an image element for the icon.
    const icon = document.createElement("img");
    icon.style.marginRight = "5px"; // adjust spacing as needed
    icon.src = "./assets/Alt1_icon.png";
    icon.alt = "Alt1";

    if (event.source === "discord") {
        icon.src = "./assets/Discord_icon.png";
        icon.alt = "Discord";
    }
    reportedByCell.appendChild(icon);

    // Append the reportedBy text after the icon.
    reportedByCell.appendChild(createElement(event.reportedBy || "Unknown", "reported-by-text", "span"));

    // Finally, add this cell to the row.
    row.appendChild(reportedByCell);

    const toggleMistyTimer = document.getElementById("toggleMistyTimer") as HTMLInputElement | null;
    if (toggleMistyTimer && toggleMistyTimer.checked) {
        updateTimer(row, { cellIndex: 3, newContent: formatTimeLeft(event) }, true);
    }

    // If current event is a pinned event or the event mode is not set to pin, add it to the top
    const favMode = localStorage.getItem("favoriteEventsMode");
    if (pin || favMode !== "pin") {
        tbody.insertBefore(row, tbody.firstChild);
        rowMap.set(event.id, row);
        return;
    }

    // Get saved favorites
    const savedFavourites = localStorage.getItem("favoriteEvents");
    const favouriteEvents = savedFavourites ? (JSON.parse(savedFavourites) as string[]) : [];

    // Get all active event rows
    const activeEventIds = eventHistory.filter(checkActive).map((event) => event.id);
    const activeTableRows = activeEventIds
        .map((id) => rowMap.get(id))
        .filter((row) => row !== undefined) as HTMLTableRowElement[];

    // Track the last favorite event row and the first non-favorite row
    let lastPinnedRow: HTMLTableRowElement | null = null;
    let firstNonFavoriteRow: HTMLTableRowElement | null = null;

    for (const tableRow of activeTableRows) {
        const eventName = tableRow.cells[1].textContent?.trim(); // Get event name from column index 1

        if (favouriteEvents.includes(eventName ?? "")) {
            lastPinnedRow = tableRow; // Keep track of the last favorite event
            break;
        }
    }

    for (const tableRow of activeTableRows) {
        const eventName = tableRow.cells[1].textContent?.trim();
        if (!favouriteEvents.includes(eventName ?? "")) {
            firstNonFavoriteRow = tableRow;
            break; // Stop at the first non-favorite row
        }
    }

    // 📌 Insertion Logic
    if (lastPinnedRow && tbody.contains(lastPinnedRow)) {
        // If there are active pinned events, insert AFTER the LAST pinned event
        tbody.insertBefore(row, lastPinnedRow.nextSibling);
    } else if (firstNonFavoriteRow && tbody.contains(firstNonFavoriteRow)) {
        // If there are no pinned events but there are non-favorite events, insert BEFORE them
        tbody.insertBefore(row, firstNonFavoriteRow);
    } else {
        // If no other rows exist, insert at the top
        tbody.insertBefore(row, tbody.firstChild);
    }
    rowMap.set(event.id, row);
}

export function removeEvent(event: EventRecord): void {
    eventHistory = eventHistory.filter((e) => e.id !== event.id);
    expiredEvents = expiredEvents.filter((e) => e.id !== event.id);
    saveEventHistory();

    const tbody = document.getElementById("eventHistoryBody");
    if (!tbody) return;

    const expiredEventRow = rowMap.get(event.id);
    if (expiredEventRow) {
        tbody.removeChild(expiredEventRow);
    }

    // Remove expired event
    rowMap.delete(event.id);
}

export function getRemainingTime(event: EventRecord): number {
    const now = Date.now();
    // Avoids clock drift from server when event.duration = 0
    const elapsed = Math.max((now - event.timestamp) / 1000, 0);
    return event.duration - elapsed;
}

export function getEndTime(event: EventRecord): number {
    return event.timestamp + event.duration * 1000;
}

function checkActive(event: EventRecord): boolean {
    return getRemainingTime(event) > 0;
}

function editEvent(event: EventRecord): void {
    const row = rowMap.get(event.id);
    if (!row) return;
    const KNOWN_EVENTS = (Object.keys(events) as EventKeys[]).filter((e) => DEBUG || e !== "Testing");

    if (!row.classList.contains("editing")) {
        row.classList.add("editing");

        // Store original values for each editable cell (indexes 1-4).
        row.dataset.originalEvent = row.cells[1].textContent || "";
        row.dataset.originalWorld = row.cells[2].textContent || "";
        row.dataset.originalDuration = row.cells[3].textContent || "";
        row.dataset.originalReportedBy = row.cells[4].textContent || "";
        row.dataset.timestamp = event.timestamp.toString() || "";

        Array.from(row.cells).forEach((cell, index) => {
            if (index === 1) {
                // Instead of setting contentEditable, replace the cell content with a drop-down.
                cell.innerHTML = "";
                const select = document.createElement("select");
                select.classList.add("event-dropdown");

                // Populate the dropdown with the known event names.
                KNOWN_EVENTS.forEach((eventName) => {
                    const option = document.createElement("option");
                    option.value = eventName;
                    option.textContent = eventName;
                    if (eventName === row.dataset.originalEvent) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                cell.appendChild(select);
            } else if (index > 0) {
                cell.contentEditable = "true";
            }
        });
    } else {
        row.classList.remove("editing");
        Array.from(row.cells).forEach((cell, index) => {
            if (index === 1) {
                // For cell 1, if it contains a dropdown, replace it with its selected value.
                const select = cell.querySelector("select");
                if (select) {
                    cell.innerHTML = "";
                    cell.textContent = select.value;
                }
            } else if (index > 0) {
                cell.contentEditable = "false";
            }
        });

        const textSpan = row.cells[4].querySelector(".reported-by-text");
        const unchanged =
            row.cells[1].textContent?.trim() === row.dataset.originalEvent?.trim() &&
            row.cells[2].textContent?.trim() === row.dataset.originalWorld?.trim() &&
            row.cells[3].textContent?.trim() === row.dataset.originalDuration?.trim() &&
            row.cells[4].textContent?.trim() === row.dataset.originalReportedBy?.trim();

        if (unchanged) {
            const iconMissing = !row.cells[4].querySelector("img");
            if (iconMissing) {
                const icon = document.createElement("img");
                icon.style.marginRight = "5px"; // Adjust spacing as needed.
                icon.src = "./assets/Alt1_icon.png";
                icon.alt = "Alt1";
                if (event.source === "discord") {
                    icon.src = "./assets/Discord_icon.png";
                    icon.alt = "Discord";
                }
                // Insert the icon at the beginning of the cell.
                row.cells[4].insertBefore(icon, row.cells[4].firstChild);
            }
            return;
        }
        const eventName = row.cells[1].textContent?.trim() as EventKeys;

        const newWorld = row.cells[2].textContent?.trim() || "";
        if (!MEMBER_WORLDS.includes(newWorld)) {
            row.cells[1].textContent = row.dataset.originalEvent ?? "";
            row.cells[2].textContent = row.dataset.originalWorld ?? "";
            row.cells[3].textContent = row.dataset.originalDuration ?? "";
            if (textSpan) textSpan.textContent = row.dataset.originalReportedBy ?? "";

            showToast("❌ Invalid world number!", "error");
            return;
        }

        // Note: if the duration cell wasn’t changed, we want to keep the original duration value.
        const newDurationText = row.cells[3].textContent?.trim() || "";
        let newDuration: number;
        let newTimestamp: number;

        // Determine if duration or event changed
        const durationChanged = newDurationText !== row.dataset.originalDuration?.trim();
        const eventChanged = eventName !== event.event;
        const maxDuration = eventTimes[eventName];

        // Parse duration only if necessary
        if (durationChanged || eventChanged) {
            newDuration = parseDuration(newDurationText);
            newTimestamp = Date.now();

            if (newDuration > maxDuration && eventName === event.event) {
                showToast("❌ Time left cannot be longer than a fresh spawn!", "error");

                // Revert all values
                row.cells[1].textContent = row.dataset.originalEvent ?? "";
                row.cells[2].textContent = row.dataset.originalWorld ?? "";
                row.cells[3].textContent = row.dataset.originalDuration ?? "";
                if (textSpan) textSpan.textContent = row.dataset.originalReportedBy ?? "";

                return;
            } else if (eventName !== event.event) {
                newDuration = Math.min(maxDuration, newDuration);
            }
        } else {
            newDuration = event.duration;
            newTimestamp = event.timestamp;
        }

        const mistyToggle = localStorage.getItem("toggleMistyTimer") === "true";
        if (mistyToggle) {
            newDuration = maxDuration - newDuration;
        }

        const token = localStorage.getItem("accessToken");
        const updatedEvent: EventRecord = {
            id: event.id,
            type: "editEvent",
            event: eventName,
            world: newWorld,
            duration: newDuration,
            reportedBy: row.cells[4].textContent?.trim() || "",
            timestamp: newTimestamp,
            oldEvent: event,
            token: token,
            source: event.source,
            profileEventKey: event.profileEventKey,
            mistyUpdate: false,
        };

        rowMap.set(event.id, row);

        const idx = eventHistory.findIndex((e) => checkActive(e) && e.id === event.id);
        if (idx !== -1) {
            eventHistory[idx] = updatedEvent;
            saveEventHistory();
            restartRefreshInterval();
        }
        wsClient.send(updatedEvent);
        showToast("✅ Event edited!");
    }
}

function formatTimeLeft(event: EventRecord): string {
    const mistyToggle = localStorage.getItem("toggleMistyTimer") === "true";
    const now = Date.now();
    const elapsed = (now - event.timestamp) / 1000;
    const maxDuration = eventTimes[event.event];
    const remaining = mistyToggle ? elapsed + (maxDuration - event.duration) : event.duration - elapsed;
    if (remaining < 0 && !mistyToggle) {
        return formatTimeLeftValue(0);
    } else if (remaining < 0 && mistyToggle) {
        return "Event starting";
    } else if (mistyToggle) {
        return remaining > maxDuration ? "Expired" : formatTimeLeftValue(remaining);
    } else {
        return formatTimeLeftValue(remaining);
    }
}

export function formatTimeLeftValue(seconds: number, showSeconds: boolean = true): string {
    const mistyToggle = localStorage.getItem("toggleMistyTimer") === "true";
    if (seconds <= 0 && !mistyToggle) return "Expired";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return showSeconds ? `${mins}m ${secs}s` : `${mins}m`;
}

function parseDuration(durationStr: string): number {
    const regex = /^\s*(?:(\d{1,2})\s*m\s*(\d{1,2})\s*s|(\d{1,3})\s*s|(\d{1,2}):(\d{1,2})|(\d{1,3}))\s*$/i;
    const match = durationStr.match(regex);
    if (!match) {
        throw new Error(`Invalid duration format: ${durationStr}`);
    }

    let totalSeconds = 0;
    if (match[1] && match[2]) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        totalSeconds = minutes * 60 + seconds;
    } else if (match[3]) {
        totalSeconds = parseInt(match[3], 10);
    } else if (match[4] && match[5]) {
        const minutes = parseInt(match[4], 10);
        const seconds = parseInt(match[5], 10);
        totalSeconds = minutes * 60 + seconds;
    } else if (match[6]) {
        totalSeconds = parseInt(match[6], 10);
    }

    return totalSeconds;
}
