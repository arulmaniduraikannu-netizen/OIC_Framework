package com.oracle.oic.pages;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.Duration;
import java.time.Clock;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.monitor.ScheduledProcessHierarchy;
import com.oracle.oic.monitor.ScheduledProcessHierarchy.Row;
import com.oracle.oic.utils.ConfigReader;

/**
 * Oracle Fusion Scheduled Processes workflow for running an existing VSA Job
 * Set. The interaction sequence and locators were verified during Phase 2 live
 * inspection of the Oracle Fusion tenant.
 */
public class ScheduledProcessesPage extends BasePage {

	private static final int MAX_RESULT_SCROLL_PASSES = Integer.getInteger("oic.monitor.maxTraversalSteps", 10000);
		private static final String RESULTS_HOST = "[id$='pt1:panel:processTreeTable']";
		private static final String READ_HIERARCHY = """
				host => {
					const normalize = text => text.replace(/\\s+/g, '').toLowerCase();
					const columns = ['Name', 'Metadata Name', 'Process ID', 'Status', 'Scheduled Time',
						'Submission Time', 'Completion Time', 'Submitted By', 'Submission Notes', 'Start Time'];
					const headers = Array.from(host.querySelectorAll('th'))
						.map(cell => normalize(cell.innerText)).filter(text => text);
					if (headers.length !== columns.length || columns.some(name =>
						headers.filter(text => text === normalize(name)).length !== 1)) {
						throw new Error('Scheduled process headers differ from the verified ten-column contract');
					}
					const records = new Map();
					for (const table of host.querySelectorAll("table[_afrit='1']")) {
						for (const innerRow of table.querySelectorAll('tr')) {
							if (innerRow.closest('table') !== table) continue;
							const cells = Array.from(innerRow.children).filter(cell => cell.tagName === 'TD');
							if (cells.length !== columns.length) continue;
							const owner = innerRow.closest('tr[_afrrk]');
							if (!owner) throw new Error('Process row has no runtime key');
							const values = {};
							for (const name of columns) {
								values[name] = cells[headers.indexOf(normalize(name))].innerText.trim();
							}
							if (!/^\\d+$/.test(values['Process ID'])) throw new Error('Invalid process ID cell');
							records.set(owner.getAttribute('_afrrk'), {
								key: owner.getAttribute('_afrrk'), path: owner.getAttribute('_afrap') || '', values
							});
						}
					}
					const slots = {};
					let total = 0;
					for (const table of host.querySelectorAll('table[_startrow][_rowcount]')) {
						const start = Number(table.getAttribute('_startrow'));
						total = Math.max(total, Number(table.getAttribute('_rowcount')));
						const owners = Array.from(table.querySelectorAll('tr[_afrrk]'))
							.filter(row => row.closest('table[_startrow]') === table);
						owners.forEach((owner, offset) => {
							const record = records.get(owner.getAttribute('_afrrk'));
							if (!record) throw new Error('Loaded range contains an unreadable keyed row');
							slots[start + offset] = record.values['Process ID'];
						});
					}
					return {rows: Array.from(records.values()), slots, total};
				}
				""";
		private static final Pattern DURATION_PART = Pattern.compile(
						"(?i)(\\d+)\\s*(days?|hours?|minutes?|seconds?|milliseconds?)\\b");
	private final Clock clock;

	public ScheduledProcessesPage(Page page) {
		this(page, Clock.systemUTC());
	}

	public ScheduledProcessesPage(Page page, Clock clock) {
		super(page);
		if (clock == null) {
			throw new IllegalArgumentException("clock cannot be null");
		}
		this.clock = clock;
	}

	private Locator scheduleNewProcessButton() {
		return getByRole(AriaRole.BUTTON, "Schedule New Process", true);
	}

	private Locator jobSetRadio() {
		return getByRole(AriaRole.RADIO, "Job Set", true);
	}

	private Locator jobRadio() {
		return getByRole(AriaRole.RADIO, "Job", true);
	}

	private Locator nameCombobox() {
		return getByRole(AriaRole.COMBOBOX, "Name", true);
	}

	private Locator okButton() {
		return getByRole(AriaRole.BUTTON, "OK", true);
	}

	private Locator submitButton() {
		return getByRole(AriaRole.BUTTON, "Submit", true);
	}

	private Locator processIdField() {
		return getByRole(AriaRole.TEXTBOX, "Process ID", true);
	}

	private Locator processNameField() {
		return getByRole(AriaRole.TEXTBOX, "Name", true);
	}

	private Locator submittedByField() {
		return getByRole(AriaRole.TEXTBOX, "Submitted By", true);
	}

	private Locator submissionNotesField() {
		return getByRole(AriaRole.TEXTBOX, "Submission Notes", true);
	}

	private Locator savedSearch() {
		return getByRole(AriaRole.COMBOBOX, "Saved Search", true);
	}

	private Locator submissionTimeOperator() {
		return getByRole(AriaRole.COMBOBOX, "Submission Time Operator", true);
	}

	private Locator searchButton() {
		return getByRole(AriaRole.BUTTON, "Search", true);
	}

	private Locator expandSearchButton() {
		return getByRole(AriaRole.BUTTON, "Expand Search", true);
	}

	private Locator hierarchyViewRadio() {
		return getByRole(AriaRole.RADIO, "Hierarchy", true);
	}

	private Locator processResultsTable() {
		return locator(RESULTS_HOST);
	}

	private Locator processResultsScroller() {
		return processResultsTable().locator("[id$='::scroller']");
	}

	private Locator noDataRow() {
		return getByRole(AriaRole.ROW, "No data to display.", true);
	}

	private Locator processRow(String processId) {
		return getByRole(processResultsTable(), AriaRole.CELL, processId, true)
				.locator("xpath=ancestor::tr[@_afrrk][1]");
	}

	public void openScheduleNewProcess() {
		waitForVisible(scheduleNewProcessButton(), ConfigReader.getActionTimeout());
		click(scheduleNewProcessButton());
	}

	public void searchProcess(String processId) {
		if (!processIdField().isVisible()) {
			waitForVisible(expandSearchButton(), ConfigReader.getActionTimeout());
			clickForce(expandSearchButton());
		}
		waitForVisible(processIdField(), ConfigReader.getActionTimeout());
		selectOption(savedSearch(), "Last 12 hours");
		selectOption(submissionTimeOperator(), "Before");
		clear(processIdField());
		fill(processIdField(), processId);
		click(searchButton());
		waitForVisible(processResultsTable(), ConfigReader.getNavigationTimeout());
		waitForVisible(processRow(processId).or(noDataRow()), ConfigReader.getNavigationTimeout());
	}

	/** Retains the unrestricted API; workbook monitoring uses the root-name overload. */
	public List<LongRunningProcess> collectAllProcessesLast72Hours() {
		return collectProcessesLast72Hours(List.of());
	}

	/** Uses the Phase 2 runtime-key, range, status-clear, and details contracts of 22 October 2026. */
	public List<LongRunningProcess> collectProcessesLast72Hours(List<String> rootNames) {
		if (rootNames == null || rootNames.stream().anyMatch(name -> name == null || name.isBlank())) {
			throw new IllegalArgumentException("Root names must be nonblank");
		}
		Locator searchPanelReady = processNameField().or(expandSearchButton());
		waitForVisible(searchPanelReady, ConfigReader.getNavigationTimeout());
		if (!processNameField().isVisible()) {
			waitForVisible(expandSearchButton(), ConfigReader.getActionTimeout());
			click(expandSearchButton());
		}
		waitForVisible(processNameField(), ConfigReader.getNavigationTimeout());
				selectOptionByLabel(savedSearch(), "Last 72 hours");
				ZonedDateTime end = ZonedDateTime.now(clock).withZoneSameInstant(
								java.time.ZoneId.of(System.getProperty("oic.monitor.uiTimeZone", "UTC")));
		DateTimeFormatter formatter = DateTimeFormatter.ofPattern("M/d/yy h:mm a", Locale.ENGLISH);
				selectOptionByLabel(submissionTimeOperator(), "Between");
		if (!getByRole(AriaRole.TEXTBOX, "From Submission Time", true).isVisible()) {
			press(submissionTimeOperator(), "Home");
			press(submissionTimeOperator(), "ArrowDown");
			press(submissionTimeOperator(), "ArrowDown");
			press(submissionTimeOperator(), "Tab");
		}
		Locator from = getByRole(AriaRole.TEXTBOX, "From Submission Time", true);
		Locator to = getByRole(AriaRole.TEXTBOX, "To Submission Time", true);
		waitForVisible(from, ConfigReader.getNavigationTimeout());
		fill(from, end.minusHours(72).format(formatter));
		press(from, "Tab");
		fill(to, end.format(formatter));
		press(to, "Tab");
		waitForVisible(hierarchyViewRadio(), ConfigReader.getActionTimeout());
		if (!hierarchyViewRadio().isChecked()) {
			clickForce(hierarchyViewRadio());
		}
		Map<String, LongRunningProcess> processes = new LinkedHashMap<>();
		for (String rootName : rootNames.isEmpty() ? List.of("") : List.copyOf(new java.util.LinkedHashSet<>(rootNames))) {
			clear(processNameField());
			if (!rootName.isEmpty()) {
				fill(processNameField(), rootName);
			}
			clear(processIdField());
			clear(submissionNotesField());
			clear(submittedByField());
			clearStatusFilter();
			evaluateJavaScript("""
			    selector => {
			        document.querySelector(selector).__oicSearchPending = true;
			    }
			    """, RESULTS_HOST);
			click(searchButton());
			waitForJavaScriptCondition("""
			    selector => {
			        const host = document.querySelector(selector);
			        return host && host.__oicSearchPending !== true
			            && window.AdfPage.PAGE.isPageFullyLoaded();
			    }
			    """, RESULTS_HOST, ConfigReader.getNavigationTimeout());
			waitForVisible(processResultsTable(), ConfigReader.getNavigationTimeout());
			if (noDataRow().isVisible()) {
				System.out.println("No recent processes for workbook root: " + rootName);
				continue;
			}
			ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(
					rootName.isEmpty() ? List.of() : List.of(rootName));
						List<LongRunningProcess> selected = collectHierarchy(hierarchy);
			System.out.printf("Workbook root '%s': %d exact-root and descendant processes%n",
					rootName, selected.size());
			selected.forEach(process -> processes.put(process.processId(), process));
		}
		return List.copyOf(processes.values());
	}

	private void clearStatusFilter() {
		Locator status = getByRole(AriaRole.TEXTBOX, "Status", true);
		Locator popup = locator("[id$='srRssdfl:value20::pop']");
		click(status);
		waitForVisible(getByRole(popup, AriaRole.CHECKBOX, "Error", true), ConfigReader.getActionTimeout());
		Locator options = popup.getByRole(AriaRole.CHECKBOX);
		int count = options.count();
		if (count != 20) {
			throw new IllegalStateException("Status popup differs from the verified 20-option contract");
		}
		for (int index = 0; index < count; index++) {
			if (options.nth(index).isChecked()) {
				uncheck(options.nth(index));
			}
		}
		for (int index = 0; index < count; index++) {
			assertThat(options.nth(index)).not().isChecked();
		}
		click(status);
		assertThat(status).hasValue("");
		assertThat(status).hasAttribute("aria-expanded", "false");
	}

	private List<LongRunningProcess> collectHierarchy(ScheduledProcessHierarchy hierarchy) {
		Map<String, LongRunningProcess> inspected = new LinkedHashMap<>();
		List<Locator> scrollers = List.of(processResultsScroller(),
				processResultsTable().locator("[id$='::db']"));
		scrollers.forEach(this::scrollToTop);
		for (int pass = 0; pass < MAX_RESULT_SCROLL_PASSES; pass++) {
			Snapshot snapshot = readHierarchy();
			hierarchy.observe(snapshot.rows(), snapshot.slots(), snapshot.total());
			int collectedAtStart = inspected.size();
			boolean expanded = false;
			for (Row row : snapshot.rows()) {
				if (!hierarchy.includes(row)) {
					continue;
				}
				Locator owner = getByRole(processRow(row.process().processId()), AriaRole.CELL,
						"Expand " + row.process().processName(), true);
				if (owner.isVisible()) {
					click(getByRole(owner, AriaRole.LINK, "Expand", true));
					waitForVisible(getByRole(processRow(row.process().processId()), AriaRole.CELL,
							"Collapse " + row.process().processName(), true), ConfigReader.getNavigationTimeout());
					waitForJavaScriptCondition("""
						argument => Array.from(document.querySelector(argument.selector)
						    .querySelectorAll('tr[_afrap]')).some(row =>
							row.getAttribute('_afrap').split('_').includes(argument.key))
						""", Map.of("selector", RESULTS_HOST, "key", row.key()), ConfigReader.getNavigationTimeout());
					hierarchy.expanded();
					scrollers.forEach(this::scrollToTop);
					expanded = true;
					break;
				}
				if (!inspected.containsKey(row.process().processId())) {
					LongRunningProcess process = row.process();
					inspected.put(process.processId(), process);
				}
			}
			if (inspected.size() > collectedAtStart) {
				System.out.printf("Collected %d scheduled processes (%d total); scroll positions=%s%n",
						inspected.size() - collectedAtStart, inspected.size(),
						scrollers.stream().map(this::getScrollTop).toList());
			}
			if (expanded) {
				continue;
			}
			boolean moved = false;
			for (Locator scroller : scrollers) {
				long currentTop = getScrollTop(scroller);
				long bottom = Math.max(0, getScrollHeight(scroller) - getClientHeight(scroller));
				if (currentTop >= bottom) {
					continue;
				}
				scrollBy(scroller, (int) Math.max(1, getClientHeight(scroller) / 2));
				moved = getScrollTop(scroller) != currentTop;
				if (moved) {
					System.out.printf("Scheduled-process traversal scrolled %d -> %d; collected=%d; positions=%s%n",
							currentTop, getScrollTop(scroller), inspected.size(),
							scrollers.stream().map(this::getScrollTop).toList());
					break;
				}
			}
			if (moved) {
				continue;
			}
			if (!hierarchy.isComplete()) {
				throw new IllegalStateException("Reached bottom with incomplete runtime row ranges");
			}
			List<LongRunningProcess> selected = hierarchy.selectedProcesses();
			if (selected.stream().anyMatch(process -> !inspected.containsKey(process.processId()))) {
				throw new IllegalStateException("Hierarchy contains unvisited process details");
			}
			return selected.stream().map(process -> inspected.get(process.processId())).toList();
		}
		throw new IllegalStateException("Hierarchy traversal exceeded its bounded scroll budget");
	}

	private record Snapshot(List<Row> rows, Map<Integer, String> slots, int total) { }

	@SuppressWarnings("unchecked")
	private Snapshot readHierarchy() {
		Map<String, Object> snapshot = (Map<String, Object>) processResultsTable().evaluate(READ_HIERARCHY);
		List<Row> rows = new ArrayList<>();
		for (Map<String, Object> raw : (List<Map<String, Object>>) snapshot.get("rows")) {
			Map<String, String> values = (Map<String, String>) raw.get("values");
			String status = values.get("Status");
			String submitted = values.get("Submission Time");
			String started = values.get("Start Time");
			String completed = values.get("Completion Time");
			rows.add(new Row((String) raw.get("key"), (String) raw.get("path"),
					new LongRunningProcess(values.get("Process ID"), values.get("Name"), status,
							values.get("Submitted By"), submitted, started, completed,
							calculateElapsed(status, submitted, started, completed))));
		}
		Map<Integer, String> slots = new HashMap<>();
		((Map<String, String>) snapshot.get("slots")).forEach((slot, id) -> slots.put(Integer.parseInt(slot), id));
		return new Snapshot(rows, slots, ((Number) snapshot.get("total")).intValue());
	}

	public static Duration parseOracleDuration(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
				String text = value.trim();
				Matcher matcher = DURATION_PART.matcher(text);
		Duration duration = Duration.ZERO;
		int end = 0;
		boolean found = false;
		while (matcher.find()) {
						if (!text.substring(end, matcher.start()).trim().matches("(?i)(?:and)?")) {
				return null;
			}
			long amount = Long.parseLong(matcher.group(1));
			String unit = matcher.group(2).toLowerCase(Locale.ENGLISH);
			duration = duration.plus(unit.startsWith("day") ? Duration.ofDays(amount)
					: unit.startsWith("hour") ? Duration.ofHours(amount)
					: unit.startsWith("minute") ? Duration.ofMinutes(amount)
					: unit.startsWith("millisecond") ? Duration.ofMillis(amount) : Duration.ofSeconds(amount));
			end = matcher.end();
			found = true;
		}
				return found && text.substring(end).isBlank() ? duration : null;
	}

	private Duration calculateElapsed(String status, String submissionTime,
			String startTime, String completionTime) {
		return LongRunningProcess.elapsedDuration(status, submissionTime, startTime, completionTime, clock);
	}

	public String getProcessStatus(String processId) {
		return getProcessResult(processId).status();
	}

	public ScheduledProcessResult getProcessResult(String processId) {
		if (noDataRow().isVisible()) {
			return new ScheduledProcessResult(processId, "", "No data to display", "", "", "");
		}
				waitForVisible(processRow(processId), ConfigReader.getNavigationTimeout());
				LongRunningProcess process = readHierarchy().rows().stream().map(Row::process)
								.filter(candidate -> candidate.processId().equals(processId)).findAny()
								.orElseThrow(() -> new IllegalStateException("Exact process ID not loaded: " + processId));
				String submissionTime = process.submissionTime();
				String completionTime = process.completionTime();
		return new ScheduledProcessResult(
								process.processId(),
								process.processName(),
								process.status(),
				submissionTime,
				completionTime,
				formatDuration(submissionTime, completionTime));
	}

	private String formatDuration(String submissionTime, String completionTime) {
		try {
			DateTimeFormatter formatter = DateTimeFormatter.ofPattern("M/d/yy h:mm a z", Locale.ENGLISH);
			long minutes = Duration.between(
					ZonedDateTime.parse(submissionTime, formatter),
					ZonedDateTime.parse(completionTime, formatter)).toMinutes();
			return minutes + (minutes == 1 ? " minute" : " minutes");
		} catch (DateTimeParseException exception) {
			return "Unavailable";
		}
	}

	private Locator optionCell(String optionName) {
		return getByRole(AriaRole.CELL, optionName, false);
	}

	public void selectOptionByName(String optionName) {

		Locator option = optionCell(optionName);
		waitForVisible(option, ConfigReader.getActionTimeout());
		waitForEnabled(option, ConfigReader.getActionTimeout());
		click(option);
	}

	public void selectJobSetType() {
		waitForVisible(jobSetRadio(), ConfigReader.getActionTimeout());
		clickForce(jobSetRadio());
	}

	public void selectJobType() {
		waitForVisible(jobRadio(), ConfigReader.getActionTimeout());
		if (!jobRadio().isChecked()) {
			clickForce(jobRadio());
		}
	}

	public void selectJob(String jobName) {
		waitForVisible(nameCombobox(), ConfigReader.getActionTimeout());
		clickForce(nameCombobox());
		fillwithenter(nameCombobox(), jobName);
		waitForEnabled(okButton(), ConfigReader.getActionTimeout());
		click(okButton());
	}

	public void configurePurge(String stagingTable, String acknowledgementText) {
		Locator stagingTableSelect = getByRole(AriaRole.COMBOBOX, "Staging Table", true);
		Locator acknowledgement = getByRole(AriaRole.CHECKBOX, acknowledgementText, true);
		waitForVisible(stagingTableSelect, ConfigReader.getActionTimeout());
		selectOptionByText(stagingTableSelect, stagingTable);
		waitForVisible(acknowledgement, ConfigReader.getActionTimeout());
		clickForce(acknowledgement);
	}

	public boolean isSubmitEnabled() {
		waitForVisible(submitButton(), ConfigReader.getActionTimeout());
		return submitButton().isEnabled();
	}

	private Locator parameterSelect(String label) {
    return getByRole(AriaRole.COMBOBOX, label, true);
}

	public void selectParameterValue(String label, String value) {
		waitForVisible(parameterSelect(label), ConfigReader.getActionTimeout());
		selectOptionByText(parameterSelect(label), value);
	}

	private Locator fromDateInput() {
		return getByRole(AriaRole.TEXTBOX, "From Date", true);
	}

	/**
	 * Shared helper to type into masked date inputs so the control processes each keystroke.
	 */
	private void setDateMasked(Locator dateLocator, String dateString) {
		waitForVisible(dateLocator, ConfigReader.getActionTimeout());
		click(dateLocator);
		clear(dateLocator);
		type(dateLocator, dateString, 100);
		press(dateLocator, "Enter");
	}

	/**
	 * Set the From Date using a LocalDate; format is M/d/yy (e.g. 8/11/26).
	 */
	public void setFromDate(LocalDate date) {
		setDateMasked(fromDateInput(), date.format(DateTimeFormatter.ofPattern("M/d/yy")));
	}

	/** Set the From Date using a preformatted string (e.g. "1/25/26"). */
	public void setFromDate(String dateString) {
		setDateMasked(fromDateInput(), dateString);
	}

	/** Convenience: set the From Date to today. */
	public void setFromDateToday() {
		setFromDate(LocalDate.now());
	}

	/** Read current value from the From Date input. */
	public String getFromDateValue() {
		return inputValue(fromDateInput());
	}

	/* -------------------- To Date support -------------------- */

	private Locator toDateInput() {
		return getByRole(AriaRole.TEXTBOX, "To Date", true);
	}

	/** Set the To Date from a LocalDate (formats to M/d/yy). */
	public void setToDate(LocalDate date) {
		setDateMasked(toDateInput(), date.format(DateTimeFormatter.ofPattern("M/d/yy")));
	}

	/** Set the To Date from a preformatted string (e.g. "1/31/26"). */
	public void setToDate(String dateString) {
		setDateMasked(toDateInput(), dateString);
	}

	/** Convenience: set To Date to today. */
	public void setToDateToday() {
		setToDate(LocalDate.now());
	}

	/** Read current value from the To Date input. */
	public String getToDateValue() {
		return inputValue(toDateInput());
	}

private Locator submissionNotesInput() {
    return getByRole(AriaRole.TEXTBOX, "Submission Notes", true);
}

public void setSubmissionNotes(String notes) {
    waitForVisible(submissionNotesInput(), ConfigReader.getActionTimeout());
    click(submissionNotesInput());
    clear(submissionNotesInput());
    fill(submissionNotesInput(), notes);
}

public String getSubmissionNotesValue() {
    return inputValue(submissionNotesInput());
}


	public void selectJobSetName(String jobSetName) {
		waitForVisible(nameCombobox(), ConfigReader.getActionTimeout());
		click(nameCombobox());

		fillwithenter(nameCombobox(), jobSetName);

		// diagnostic: capture the screen right after the dropdown selection
		// so the state (dropdown open/closed, value committed) is visible
		page.screenshot(new Page.ScreenshotOptions()
				.setPath(Paths.get("test-results/screenshots", "step1-select-dropdown.png")));

		waitForVisible(click_OK_Button(), ConfigReader.getActionTimeout());
		clickForce(click_OK_Button());

		// diagnostic: capture the screen right after clicking OK so we can
		// see whether the Process Details dialog opened or OK did nothing
		page.screenshot(new Page.ScreenshotOptions()
				.setPath(Paths.get("test-results/screenshots", "step2-click-ok.png")));

		// TIMING: the Process Details dialog and its job-definition table
		// load asynchronously after OK and can exceed the action timeout.
		// Wait on the job-definitions table with the navigation timeout
		// (verified live 2026-08-16; the option cells render right after it
		// appears). Note: the dialog header text "Process Details" is also
		// present as a hidden link in the page, so it is not a valid anchor.
		waitForVisible(
				getByRole(AriaRole.TABLE, "List of job definitions", true),
				ConfigReader.getNavigationTimeout());

	}

	public Locator click_OK_Button() {
		waitForVisible(okButton(), ConfigReader.getActionTimeout());
		return okButton();
	}
}
