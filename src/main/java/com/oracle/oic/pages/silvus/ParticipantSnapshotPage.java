package com.oracle.oic.pages.silvus;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.pages.HomePage;
import com.oracle.oic.utils.ConfigReader;

/** Participant Snapshot flow verified in the Dev3 Phase 2 UI inspection. */
public class ParticipantSnapshotPage extends BasePage {

    public ParticipantSnapshotPage(Page page) {
        super(page);
    }

    private Locator pageHeading() {
        return getByRole(AriaRole.HEADING, "Participant Snapshot", true);
    }

    private Locator homeLink() {
        return getByRole(AriaRole.LINK, "Home", true);
    }

    private Locator selectParticipantLink() {
        return getByRole(AriaRole.LINK, "Select Participant", true);
    }

    private Locator incentiveCompensationTab() {
        return getByRole(AriaRole.TAB, "Incentive Compensation", true);
    }

    private Locator participantNameField() {
        return getByRole(AriaRole.TEXTBOX, "Name", true);
    }

    private Locator searchButton() {
        return getByRole(AriaRole.BUTTON, "Search", true);
    }

    private Locator participantRow(String participant, String plan) {
        return getByRole(AriaRole.ROW, participant, false)
                .filter(new Locator.FilterOptions().setHasText(plan)).first();
    }

    private Locator participantLink(Locator row, String participant) {
        return getByRole(row, AriaRole.LINK, participant, true);
    }

    private Locator tasksLink() {
        return getByRole(AriaRole.LINK, "Tasks", true);
    }

    private Locator manageEarningsLink() {
        return getByRole(AriaRole.LINK, "Manage Earnings", true);
    }

    public void waitForPage() {
        waitForVisible(pageHeading(), ConfigReader.getNavigationTimeout());
    }

    public void openFromHome() {
        click(homeLink());
        waitForADFSpinnerToDisappear();
        waitForLoadingMask();
        new HomePage(page).selectIncentiveCompensation();
        waitForVisible(incentiveCompensationTab(), ConfigReader.getActionTimeout());
        safeClick(incentiveCompensationTab());
        waitForADFSpinnerToDisappear();
        waitForLoadingMask();
        Locator participantSnapshotLink = getByRole(AriaRole.LINK, "Participant Snapshot", true);
        waitForVisible(participantSnapshotLink, ConfigReader.getNavigationTimeout());
        clickForce(participantSnapshotLink);
       // waitForPage();
      //  waitForADFSpinnerToDisappear();
        //waitForLoadingMask();
        waitForVisible(selectParticipantLink(), ConfigReader.getActionTimeout());
        click(selectParticipantLink());
        waitForVisible(participantNameField(), ConfigReader.getNavigationTimeout());
    }

    public void openManageEarnings(String participant, String plan) {
        waitForVisible(participantNameField(), ConfigReader.getActionTimeout());
        fill(participantNameField(), participant);
        click(searchButton());
        Locator row = participantRow(participant, plan);
        waitForVisible(row, ConfigReader.getNavigationTimeout());
        click(participantLink(row, participant));
        waitForVisible(tasksLink(), ConfigReader.getActionTimeout());
        click(tasksLink());
        waitForVisible(manageEarningsLink(), ConfigReader.getActionTimeout());
        click(manageEarningsLink());
    }
}