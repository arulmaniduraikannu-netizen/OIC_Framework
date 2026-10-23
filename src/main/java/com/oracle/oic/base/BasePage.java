package com.oracle.oic.base;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import com.microsoft.playwright.Dialog;
import com.microsoft.playwright.Download;
import com.microsoft.playwright.FileChooser;
import com.microsoft.playwright.Frame;
import com.microsoft.playwright.FrameLocator;
import com.microsoft.playwright.Keyboard;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Mouse;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.TimeoutError;
import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;
import com.microsoft.playwright.assertions.LocatorAssertions;
import com.microsoft.playwright.options.AriaRole;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.MouseButton;
import com.microsoft.playwright.options.SelectOption;
import com.microsoft.playwright.options.WaitForSelectorState;

/**
 * BasePage contains reusable Playwright wrapper methods.
 *
 * Responsibilities:
 * - Store Page reference
 * - Create reusable locators
 * - Provide locator abstraction for Page Objects
 *
 * UI actions like click/fill/wait will be added in next parts.
 */
public abstract class BasePage {


    /**
     * Playwright page instance.
     */
    protected final Page page;


    /**
     * Constructor.
     *
     * Every Page Object will pass Playwright Page here.
     *
     * Example:
     *
     * LoginPage(Page page)
     * {
     *     super(page);
     * }
     */
    protected BasePage(Page page) {

        if (page == null) {

            throw new IllegalArgumentException(
                    "Page object cannot be null");
        }

        this.page = page;
    }


    protected Path captureScreenshot(Path screenshotPath) {
        Path absolutePath = screenshotPath.toAbsolutePath();
        page.screenshot(new Page.ScreenshotOptions()
                .setPath(absolutePath)
                .setFullPage(false)
                .setTimeout(10_000));
        return absolutePath;
    }


    //====================================================
    // Role Locators
    //====================================================


    /**
     * Get locator by ARIA role.
     *
     * Example:
     *
     * getByRole(
     *     AriaRole.BUTTON,
     *     "Save"
     * );
     */
    protected Locator getByRole(
            AriaRole role,
            String name) {


        return page.getByRole(
                role,
                new Page.GetByRoleOptions()
                        .setName(name));
    }


    /**
     * Get locator by role without name.
     *
     * Example:
     *
     * getByRole(
     *     AriaRole.BUTTON
     * );
     */
    protected Locator getByRole(
            AriaRole role) {


        return page.getByRole(role);
    }


    /**
     * Get locator by role with exact matching.
     *
     * Example:
     *
     * getByRole(
     *     AriaRole.BUTTON,
     *     "Save",
     *     true
     * );
     */
    protected Locator getByRole(
            AriaRole role,
            String name,
            boolean exact) {


        return page.getByRole(
                role,
                new Page.GetByRoleOptions()
                        .setName(name)
                        .setExact(exact));
    }

                /**
                 * Get a role locator scoped to an existing container.
                 */
                protected Locator getByRole(
                    Locator container,
                    AriaRole role,
                    String name,
                    boolean exact) {

                return container.getByRole(
                    role,
                    new Locator.GetByRoleOptions()
                        .setName(name)
                        .setExact(exact));
                }



    //====================================================
    // Text Locator
    //====================================================


    /**
     * Finds element by visible text.
     */
    protected Locator getByText(
            String text) {


        return page.getByText(text);
    }


    /**
     * Finds exact visible text.
     */
    protected Locator getByText(
            String text,
            boolean exact) {


        return page.getByText(
                text,
                new Page.GetByTextOptions()
                        .setExact(exact));
    }

                /**
                 * Finds exact visible text within an existing container.
                 */
                protected Locator getByText(
                    Locator container,
                    String text,
                    boolean exact) {

                return container.getByText(
                    text,
                    new Locator.GetByTextOptions()
                        .setExact(exact));
                }

    /**
     * Finds visible text using a regular expression.
     */
    protected Locator getByText(
            java.util.regex.Pattern pattern) {


        return page.getByText(pattern);
    }



    //====================================================
    // Label Locator
    //====================================================


    /**
     * Finds form control using label.
     *
     * Example:
     *
     * Username textbox
     */
    protected Locator getByLabel(
            String label) {


        return page.getByLabel(label);
    }


    /**
     * Finds label with exact matching.
     */
    protected Locator getByLabel(
            String label,
            boolean exact) {


        return page.getByLabel(
                label,
                new Page.GetByLabelOptions()
                        .setExact(exact));
    }



    //====================================================
    // Placeholder Locator
    //====================================================


    /**
     * Finds element by placeholder.
     */
    protected Locator getByPlaceholder(
            String placeholder) {


        return page.getByPlaceholder(
                placeholder);
    }


    /**
     * Finds element by exact placeholder.
     */
    protected Locator getByPlaceholder(
            String placeholder,
            boolean exact) {


        return page.getByPlaceholder(
                placeholder,
                new Page.GetByPlaceholderOptions()
                        .setExact(exact));
    }



    //====================================================
    // Test ID Locator
    //====================================================


    /**
     * Finds element by data-testid.
     */
    protected Locator getByTestId(
            String testId) {


        return page.getByTestId(testId);
    }



    //====================================================
    // Title Locator
    //====================================================


    /**
     * Finds element by title attribute.
     */
    protected Locator getByTitle(
            String title) {


        return page.getByTitle(title);
    }


    /**
     * Finds element by exact title.
     */
    protected Locator getByTitle(
            String title,
            boolean exact) {


        return page.getByTitle(
                title,
                new Page.GetByTitleOptions()
                        .setExact(exact));
    }

                /**
                 * Finds an exact title within an existing container.
                 */
                protected Locator getByTitle(
                    Locator container,
                    String title,
                    boolean exact) {

                return container.getByTitle(
                    title,
                    new Locator.GetByTitleOptions()
                        .setExact(exact));
                }



    //====================================================
    // Raw Locator (Last Resort)
    //====================================================


    /**
     * CSS/XPath locator.
     *
     * Use only when Playwright recommended
     * locators cannot identify the element.
     */
    protected Locator locator(
            String selector) {


        return page.locator(selector);
    }



    /**
     * Returns current page.
     *
     * Useful for advanced operations:
     * frames, tabs, downloads etc.
     */
    protected Page getPage() {

        return page;
    }

  //====================================================
 // Click Actions
 //====================================================


 /**
  * Core click action.
  *
  * Playwright automatically waits for:
  * - element attached
  * - visible
  * - stable
  * - receiving events
  * - enabled
  */
 protected void click(Locator locator) {

     validateLocator(locator);

     locator.click();
 }


 /**
  * Click with force option.
  *
  * Use ONLY when UI overlays/interception
  * prevent normal clicking.
  *
  * Example:
  * Fluent UI overlay issue.
  */
 protected void clickForce(Locator locator) {

     validateLocator(locator);

     locator.click(
             new Locator.ClickOptions()
                     .setForce(true));
 }


 /**
  * Click with timeout.
  *
  * Use only for genuinely slow operations.
  */
 protected void click(
         Locator locator,
         double timeout) {


     validateLocator(locator);

     locator.click(
             new Locator.ClickOptions()
                     .setTimeout(timeout));
 }


 //====================================================
 // Click By Role
 //====================================================


 /**
  * Click element by role and name.
  *
  * Example:
  *
  * clickByRole(
  *      AriaRole.BUTTON,
  *      "Save"
  * );
  */
 protected void clickByRole(
         AriaRole role,
         String name) {


     click(
         getByRole(role, name)
     );
 }


 /**
  * Click role with exact matching.
  *
  * Example:
  *
  * Button:
  * Save
  * Save Draft
  *
  * exact=true clicks only Save.
  */
 protected void clickByRole(
         AriaRole role,
         String name,
         boolean exact) {


     click(
         getByRole(
                 role,
                 name,
                 exact)
     );
 }


 /**
  * Click role without name.
  *
  * Example:
  *
  * First unique button.
  */
 protected void clickByRole(
         AriaRole role) {


     click(
         getByRole(role)
     );
 }


 /**
  * Click role with timeout.
  */
 protected void clickByRole(
         AriaRole role,
         String name,
         double timeout) {


     click(
         getByRole(role, name),
         timeout
     );
 }


 //====================================================
 // Double Click Actions
 //====================================================


 /**
  * Core double click.
  */
 protected void doubleClick(
         Locator locator) {


     validateLocator(locator);

     locator.dblclick();
 }


 /**
  * Double click with timeout.
  */
 protected void doubleClick(
         Locator locator,
         double timeout) {


     validateLocator(locator);

     locator.dblclick(
             new Locator.DblclickOptions()
                     .setTimeout(timeout));
 }



 //====================================================
 // Double Click By Role
 //====================================================


 /**
  * Double click by role and name.
  */
 protected void doubleClickByRole(
         AriaRole role,
         String name) {


     doubleClick(
             getByRole(role, name)
     );
 }


 /**
  * Double click role with exact match.
  */
 protected void doubleClickByRole(
         AriaRole role,
         String name,
         boolean exact) {


     doubleClick(
             getByRole(
                     role,
                     name,
                     exact)
     );
 }


 //====================================================
 // Right Click Actions
 //====================================================


 /**
  * Core right click.
  */
 protected void rightClick(
         Locator locator) {


     validateLocator(locator);

     locator.click(
             new Locator.ClickOptions()
                     .setButton(
                             MouseButton.RIGHT));
 }


 /**
  * Right click with timeout.
  */
 protected void rightClick(
         Locator locator,
         double timeout) {


     validateLocator(locator);

     locator.click(
             new Locator.ClickOptions()
                     .setButton(
                             MouseButton.RIGHT)
                     .setTimeout(timeout));
 }



 //====================================================
 // Right Click By Role
 //====================================================


 /**
  * Right click by role and name.
  */
 protected void rightClickByRole(
         AriaRole role,
         String name) {


     rightClick(
             getByRole(role, name)
     );
 }


 /**
  * Right click with exact role match.
  */
 protected void rightClickByRole(
         AriaRole role,
         String name,
         boolean exact) {


     rightClick(
             getByRole(
                     role,
                     name,
                     exact)
     );
 }



 //====================================================
 // Validation Helper
 //====================================================


 /**
  * Prevents NullPointerException
  * and gives meaningful error.
  */
 private void validateLocator(
         Locator locator) {


     if (locator == null) {

         throw new IllegalArgumentException(
                 "Locator cannot be null");
     }
 }
    
//====================================================
//Input Actions
//====================================================


/**
* Fill text into an input field.
*
* fill() automatically:
* - waits for element
* - focuses element
* - clears existing value
* - enters text
*/
protected void fill(
      Locator locator,
      String value) {


  validateLocator(locator);

  locator.fill(value);
}

protected void fillwithenter(Locator locator, String value) {
    validateLocator(locator);
    locator.fill(value);
    locator.press("Enter", new Locator.PressOptions().setTimeout(5000));
}

/**
* Fill with timeout.
*/
protected void fill(
      Locator locator,
      String value,
      double timeout) {


  validateLocator(locator);

  locator.fill(
          value,
          new Locator.FillOptions()
                  .setTimeout(timeout));
}



//====================================================
//Fill By Role
//====================================================


/**
* Fill textbox using role.
*
* Example:
*
* fillByRole(
*      AriaRole.TEXTBOX,
*      "Username",
*      "admin"
* );
*/
protected void fillByRole(
      AriaRole role,
      String name,
      String value) {


  fill(
      getByRole(role, name),
      value
  );
}


/**
* Fill role with exact matching.
*/
protected void fillByRole(
      AriaRole role,
      String name,
      boolean exact,
      String value) {


  fill(
      getByRole(
              role,
              name,
              exact),
      value
  );
}



//====================================================
//Fill By Label
//====================================================


/**
* Fill input using label.
*
* Example:
*
* Username:
* [________]
*/
protected void fillByLabel(
      String label,
      String value) {


  fill(
      getByLabel(label),
      value
  );
}


/**
* Fill label with exact match.
*/
protected void fillByLabel(
      String label,
      boolean exact,
      String value) {


  fill(
      getByLabel(
              label,
              exact),
      value
  );
}



//====================================================
//Type Actions
//====================================================


/**
* Types text character by character.
*
* Difference:
*
* fill()
* -----
* Clears existing value
* Faster
*
* type()
* -----
* Simulates keyboard typing
*/
protected void type(
      Locator locator,
      String value) {


  validateLocator(locator);

  locator.type(value);
}


/**
* Type with delay between keys.
*/
protected void type(
      Locator locator,
      String value,
      double delay) {


  validateLocator(locator);

  locator.type(
          value,
          new Locator.TypeOptions()
                  .setDelay(delay));
}



//====================================================
//Clear Actions
//====================================================


/**
* Clears input value.
*/
protected void clear(
      Locator locator) {


  validateLocator(locator);

  locator.clear();
}



//====================================================
//Keyboard Actions
//====================================================


/**
* Press keyboard key.
*
* Example:
*
* press(
*      textbox,
*      "ENTER");
*/
protected void press(
      Locator locator,
      String key) {


  validateLocator(locator);

  locator.press(key);
}


/**
* Press keyboard key with timeout.
*/
protected void press(
      Locator locator,
      String key,
      double timeout) {


  validateLocator(locator);

  locator.press(
          key,
          new Locator.PressOptions()
                  .setTimeout(timeout));
}



//====================================================
//Page Keyboard Helpers
//====================================================


/**
* Returns Playwright keyboard object.
*
* Used for advanced keyboard actions.
*/
protected Keyboard keyboard() {

  return page.keyboard();
}


/**
* Press key directly on page.
*
* Example:
*
* keyboardPress("Escape");
*/
protected void keyboardPress(
      String key) {


  page.keyboard()
          .press(key);
}


/**
* Type using keyboard.
*/
protected void keyboardType(
      String text) {


  page.keyboard()
          .type(text);
}


/**
* Insert text without keyboard events.
*/
protected void keyboardInsertText(
      String text) {


  page.keyboard()
          .insertText(text);
}



//====================================================
//Input Value
//====================================================


/**
* Gets current input value.
*/
protected String inputValue(
      Locator locator) {


  validateLocator(locator);

  return locator.inputValue();
}

/**
* Gets visible text from a locator.
*/
protected String innerText(
            Locator locator) {


    validateLocator(locator);

    return locator.innerText();
}

/**
* Wait until a locator's text differs from the value observed before an action.
*/
protected void waitForTextChange(
        Locator locator,
        String previousText,
        double timeout) {


    validateLocator(locator);

    assertThat(locator)
        .not()
        .hasText(previousText,
            new LocatorAssertions.HasTextOptions()
                .setTimeout(timeout));
}
 
//====================================================
//Checkbox Actions
//====================================================


/**
* Checks checkbox.
*
* Uses Playwright auto-waiting.
*
* Recommended for:
* - native checkbox
* - accessible checkbox
*/
protected void check(
     Locator locator) {


 validateLocator(locator);

 locator.check();
}


/**
* Checks checkbox with timeout.
*/
protected void check(
     Locator locator,
     double timeout) {


 validateLocator(locator);

 locator.check(
         new Locator.CheckOptions()
                 .setTimeout(timeout));
}



/**
* Unchecks checkbox.
*/
protected void uncheck(
     Locator locator) {


 validateLocator(locator);

 locator.uncheck();
}


/**
* Unchecks checkbox with timeout.
*/
protected void uncheck(
     Locator locator,
     double timeout) {


 validateLocator(locator);

 locator.uncheck(
         new Locator.UncheckOptions()
                 .setTimeout(timeout));
}



//====================================================
//Checkbox By Role
//====================================================


/**
* Check checkbox using accessible name.
*
* Example:
*
* Group:
* "Developers"
*/
protected void checkByRole(
     String name) {


 check(
     getByRole(
         AriaRole.CHECKBOX,
         name)
 );
}



/**
* Uncheck checkbox using accessible name.
*/
protected void uncheckByRole(
     String name) {


 uncheck(
     getByRole(
         AriaRole.CHECKBOX,
         name)
 );
}


/**
* Check checkbox with exact name.
*/
protected void checkByRole(
     String name,
     boolean exact) {


 check(
     getByRole(
         AriaRole.CHECKBOX,
         name,
         exact)
 );
}



//====================================================
//Checkbox State
//====================================================


/**
* Returns checkbox checked state.
*/
protected boolean isChecked(
     Locator locator) {


 validateLocator(locator);

 return locator.isChecked();
}


/**
* Verify checkbox state.
*/
protected boolean isCheckedByRole(
     String name) {


 return isChecked(
     getByRole(
         AriaRole.CHECKBOX,
         name)
 );
}



//====================================================
//Radio Button Actions
//====================================================


/**
* Select radio button.
*/
protected void selectRadio(
     Locator locator) {


 validateLocator(locator);

 locator.check();
}


/**
* Select radio using role.
*/
protected void selectRadioByRole(
     String name) {


 selectRadio(
     getByRole(
         AriaRole.RADIO,
         name)
 );
}


//====================================================
//Dropdown / Select Actions
//====================================================


/**
* Select option by value.
*
* Works for HTML:
*
* <select>
*/
protected void selectOption(
     Locator locator,
     String value) {


 validateLocator(locator);

 locator.selectOption(value);
}


/**
* Select option by visible label.
*/
protected void selectOptionByLabel(
     Locator locator,
     String label) {


 validateLocator(locator);

 locator.selectOption(
         new SelectOption()
                 .setLabel(label));
}


/**
* Select option by text.
*/
protected void selectOptionByText(
     Locator locator,
     String text) {


 validateLocator(locator);

 locator.selectOption(
         new SelectOption()
                 .setLabel(text));
}


/**
* Select option by value.
*/
protected void selectOptionByValue(
     Locator locator,
     String value) {


 validateLocator(locator);

 locator.selectOption(value);
}


/** Waits until a native select contains the requested visible option. */
protected void waitForOption(
     Locator select,
     String optionText) {

 validateLocator(select);

 Locator option = select.locator("option")
     .filter(new Locator.FilterOptions().setHasText(optionText));
 waitForAttached(option);
}



//====================================================
//Dropdown By Label
//====================================================


/**
* Select dropdown option using label.
*
* Example:
*
* Environment
*   QA
*/
protected void selectByLabel(
     String dropdownLabel,
     String optionLabel) {


 selectOptionByLabel(
     getByLabel(dropdownLabel),
     optionLabel);
}


/**
* Select dropdown option using text.
*/
protected void selectByText(
     Locator locator,
     String text) {


 selectOptionByText(
     locator,
     text);
}


/**
* Select dropdown option using value.
*/
protected void selectByValue(
     Locator locator,
     String value) {


 selectOptionByValue(
     locator,
     value);
}

//====================================================
//Mouse Actions
//====================================================


/**
* Hover over an element.
*
* Playwright waits automatically until
* element is ready for hover.
*/
protected void hover(
     Locator locator) {


 validateLocator(locator);

 locator.hover();
}


/**
* Hover with timeout.
*/
protected void hover(
     Locator locator,
     double timeout) {


 validateLocator(locator);

 locator.hover(
         new Locator.HoverOptions()
                 .setTimeout(timeout));
}



//====================================================
//Mouse Move
//====================================================


/**
* Move mouse to coordinates.
*
* Useful for:
* - canvas
* - custom controls
* - grids
*/
protected void mouseMove(
     double x,
     double y) {


 page.mouse()
         .move(x, y);
}


/**
* Move mouse relative to element.
*/
protected void mouseMove(
     Locator locator) {


 validateLocator(locator);

 locator.hover();
}



//====================================================
//Drag and Drop
//====================================================


/**
* Drag element to target.
*/
protected void dragAndDrop(
     Locator source,
     Locator target) {


 validateLocator(source);

 validateLocator(target);

 source.dragTo(target);
}


/**
* Drag and drop using selectors.
*/
protected void dragAndDrop(
     String source,
     String target) {


 dragAndDrop(
         locator(source),
         locator(target));
}



//====================================================
//Scroll Actions
//====================================================


/**
* Scroll element into visible area.
*
* Recommended instead of JavaScript scrolling.
*/
protected void scrollIntoView(
     Locator locator) {


 validateLocator(locator);

 locator.scrollIntoViewIfNeeded();
}


/**
* Scroll page to top.
*/
protected void scrollToTop() {


 page.evaluate(
         "() => window.scrollTo(0,0)");
}


/**
* Scroll page to bottom.
*/
protected void scrollToBottom() {


 page.evaluate(
         "() => window.scrollTo(0,document.body.scrollHeight)");
}


/**
 * Scroll an internal results container to its last rendered position.
 */
protected void scrollToBottom(
     Locator target) {


 validateLocator(target);

 target.evaluate(
     "element => element.scrollTop = element.scrollHeight");
}


/**
 * Scroll an internal container to its first rendered position.
 */
protected void scrollToTop(
     Locator target) {


 validateLocator(target);

 target.evaluate(
     "element => element.scrollTop = 0");
}

/** Read the current vertical scroll position of an internal container. */
protected long getScrollTop(Locator target) {
 validateLocator(target);
 return ((Number) target.evaluate("element => element.scrollTop")).longValue();
}

/** Read the total scrollable height of an internal container. */
protected long getScrollHeight(Locator target) {
 validateLocator(target);
 return ((Number) target.evaluate("element => element.scrollHeight")).longValue();
}

/** Read the visible height of an internal container. */
protected long getClientHeight(Locator target) {
 validateLocator(target);
 return ((Number) target.evaluate("element => element.clientHeight")).longValue();
}


/**
 * Advance an internal container so virtualized rows can be captured.
 */
protected void scrollBy(
     Locator target,
     int y) {


 validateLocator(target);

 target.evaluate(
     "(element, distance) => element.scrollTop += distance",
     y);
}


/**
* Scroll by pixels.
*/
protected void scrollBy(
     int x,
     int y) {


 page.evaluate(
         "({x,y}) => window.scrollBy(x,y)",
         Map.of(
                 "x", x,
                 "y", y
         ));
}



//====================================================
//JavaScript Actions
//====================================================


/**
* Execute JavaScript.
*
* Use only when Playwright API
* cannot achieve the action.
*/
protected Object evaluateJavaScript(
     String script) {


 return page.evaluate(script);
}


/**
* Execute JavaScript with argument.
*/
protected Object evaluateJavaScript(
     String script,
     Object argument) {


 return page.evaluate(
         script,
         argument);
}

protected void waitForJavaScriptCondition(
     String expression,
     Object argument,
     double timeout) {

 page.waitForFunction(expression, argument,
     new Page.WaitForFunctionOptions().setTimeout(timeout));
}



//====================================================
//Focus / Blur Actions
//====================================================


/**
* Focus element.
*/
protected void focus(
     Locator locator) {


 validateLocator(locator);

 locator.focus();
}


/**
* Remove focus from element.
*/
protected void blur(
     Locator locator) {


 validateLocator(locator);

 page.evaluate(
         "element => element.blur()",
         locator);
}



//====================================================
//Mouse Object Access
//====================================================


/**
* Returns Playwright mouse object.
*
* Useful for advanced scenarios.
*/
protected Mouse mouse() {

 return page.mouse();
}


/**
* Scroll a target using a real wheel event so lazy-rendered content can load.
*/
protected void scrollWithMouseWheel(
     Locator locator,
     int deltaY) {


 validateLocator(locator);

 locator.hover();
 mouse().wheel(0, deltaY);
}

//====================================================
//Wait Utilities
//====================================================


/**
* Wait until element becomes visible.
*
* Use only when you need an explicit wait.
*/
protected void waitForVisible(
     Locator locator) {

 validateLocator(locator);

 locator.waitFor(
         new Locator.WaitForOptions()
                 .setState(
                         WaitForSelectorState.VISIBLE));
}

/**
* Wait until element becomes visible with a custom timeout.
*/
protected void waitForVisible(
     Locator locator,
     double timeout) {

 validateLocator(locator);

 locator.waitFor(
         new Locator.WaitForOptions()
                 .setState(
                         WaitForSelectorState.VISIBLE)
                 .setTimeout(timeout));
}


/**
* Wait until element becomes hidden.
*/
protected void waitForHidden(
     Locator locator) {

 validateLocator(locator);

 locator.waitFor(
         new Locator.WaitForOptions()
                 .setState(
                         WaitForSelectorState.HIDDEN));
}


/**
* Wait until element is attached to DOM.
*/
protected void waitForAttached(
     Locator locator) {

 validateLocator(locator);

 locator.waitFor(
         new Locator.WaitForOptions()
                 .setState(
                         WaitForSelectorState.ATTACHED));
}


/**
* Wait until element is attached to DOM with a custom timeout.
*/
protected void waitForAttached(
     Locator locator,
     double timeout) {

 validateLocator(locator);

 locator.waitFor(
     new Locator.WaitForOptions()
         .setState(
             WaitForSelectorState.ATTACHED)
         .setTimeout(timeout));
}


/**
* Wait until element is enabled.
*
* Uses assertion because it retries.
*/
protected void waitForEnabled(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isEnabled();
}


/**
 * Wait until element is enabled with a custom timeout.
 */
protected void waitForEnabled(
     Locator locator,
     double timeout) {

 validateLocator(locator);

 locator.waitFor(
         new Locator.WaitForOptions()
                 .setState(WaitForSelectorState.VISIBLE)
                 .setTimeout(timeout));

 assertThat(locator)
         .isEnabled();
}


/**
* Wait for URL change.
*/
protected void waitForURL(
     String url) {

 page.waitForURL(url);
}


/**
* Wait for URL using regex.
*/
protected void waitForURL(
     java.util.regex.Pattern pattern) {

 page.waitForURL(pattern);
}


/**
 * Waits for a URL matching the supplied pattern with an explicit timeout.
 */
protected void waitForURL(
     java.util.regex.Pattern pattern,
     double timeout) {

 page.waitForURL(
         pattern,
         new Page.WaitForURLOptions()
                 .setTimeout(timeout));
}


/**
 * Returns whether the current page URL matches the supplied pattern.
 */
protected boolean isCurrentUrlMatching(
     java.util.regex.Pattern pattern) {

 return pattern.matcher(page.url()).matches();
}


/**
* Wait for page load state.
*
* Example:
*
* LOAD
* DOMCONTENTLOADED
* NETWORKIDLE
**/

protected void waitForLoadState(
    LoadState state) {

 page.waitForLoadState(state);
}



//====================================================
//Web First Assertions
//====================================================


/**
* Assert element is visible.
*
* Auto retries until timeout.
*/
protected void assertVisible(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isVisible();
}


/**
* Assert element is hidden.
*/
protected void assertHidden(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isHidden();
}


/**
* Assert element contains text.
*/
protected void assertText(
     Locator locator,
     String text) {

 validateLocator(locator);

 assertThat(locator)
         .containsText(text);
}


/**
* Assert exact text.
*/
protected void assertExactText(
     Locator locator,
     String text) {

 validateLocator(locator);

 assertThat(locator)
         .hasText(text);
}


/**
* Assert exact text using an explicit timeout.
*/
protected void assertExactText(
     Locator locator,
     String text,
     double timeout) {

 validateLocator(locator);

 assertThat(locator)
     .hasText(text,
         new LocatorAssertions.HasTextOptions()
             .setTimeout(timeout));
}


/**
* Assert URL.
*/
protected void assertURL(
     String url) {

 assertThat(page)
         .hasURL(url);
}


/**
* Assert URL using regex.
*/
protected void assertURL(
     java.util.regex.Pattern pattern) {

 assertThat(page)
         .hasURL(pattern);
}


/**
* Assert element enabled.
*/
protected void assertEnabled(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isEnabled();
}


/**
* Assert element disabled.
*/
protected void assertDisabled(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isDisabled();
}


/**
* Assert checkbox/radio checked.
*/
protected void assertChecked(
     Locator locator) {

 validateLocator(locator);

 assertThat(locator)
         .isChecked();
}
//====================================================
//Frame Actions
//====================================================


/**
* Returns frame locator.
*
* Recommended approach for interacting
* inside iframe.
*/
protected FrameLocator frameLocator(
     String selector) {

 return page.frameLocator(selector);
}


/** Returns a nested frame locator from an existing frame. */
protected FrameLocator frameLocator(
     FrameLocator parent,
     String selector) {

 return parent.frameLocator(selector);
}


/**
* Returns frame locator using locator.
*/
protected FrameLocator frameLocator(
     Locator locator,String selector) {

 validateLocator(locator);

 return page.frameLocator(selector);
}


/**
* Gets frame by name or URL.
*/
protected Frame getFrame(
     String nameOrUrl) {

 return page.frame(nameOrUrl);
}


 //====================================================
 // Frame-scoped Locator Helpers
 // Use these inside page objects instead of calling
 // FrameLocator raw API directly.
 //====================================================

 /** Role locator scoped to a frame. */
 protected Locator frameGetByRole(
         FrameLocator frame,
         AriaRole role,
         String name,
         boolean exact) {

     return frame.getByRole(
             role,
             new FrameLocator.GetByRoleOptions()
                     .setName(name)
                     .setExact(exact));
 }

 /** Label locator scoped to a frame. */
 protected Locator frameGetByLabel(
         FrameLocator frame,
         String label,
         boolean exact) {

     return frame.getByLabel(
             label,
             new FrameLocator.GetByLabelOptions()
                     .setExact(exact));
 }

 /** Text locator scoped to a frame. */
 protected Locator frameGetByText(
         FrameLocator frame,
         String text,
         boolean exact) {

     return frame.getByText(
             text,
             new FrameLocator.GetByTextOptions()
                     .setExact(exact));
 }

 /** CSS/XPath locator scoped to a frame. */
 protected Locator frameQuery(
         FrameLocator frame,
         String selector) {

     return frame.locator(selector);
 }


/**
* Returns all frames available.
*/
protected List<Frame> getFrames() {

 return page.frames();
}


/**
* Executes action inside frame.
*
* Example:
*
* Frame frame = getFrame("iframeName");
*/
protected void switchToFrame(
     Frame frame,
     Runnable action) {


 if (frame == null) {

     throw new IllegalArgumentException(
             "Frame cannot be null");
 }


 action.run();
}



//====================================================
//Tab / Window Handling
//====================================================


/**
* Returns all opened tabs.
*/
protected List<Page> getTabs() {

 return page.context()
         .pages();
}


/**
* Returns tab count.
*/
protected int getTabCount() {

 return getTabs().size();
}


/**
* Switches to tab by index.
*/
protected Page switchToTab(
     int index) {


 List<Page> pages =
         getTabs();


 if (index < 0 ||
         index >= pages.size()) {


     throw new IllegalArgumentException(
             "Invalid tab index : "
                     + index);
 }


 Page selectedPage =
         pages.get(index);


 selectedPage.bringToFront();


 return selectedPage;
}


/**
* Switches to latest opened tab.
*/
protected Page switchToNewTab() {


 List<Page> pages =
         getTabs();


 if (pages.isEmpty()) {

     throw new IllegalStateException(
             "No tabs available");
 }


 Page newPage =
         pages.get(
                 pages.size() - 1);


 newPage.bringToFront();


 return newPage;
}



//====================================================
//Popup / Dialog Handling
//====================================================


/**
* Accept browser dialog.
*
* Handles:
* alert
* confirm
*/
protected void acceptDialog() {


 page.onDialog(
         Dialog::accept);
}


/**
* Dismiss browser dialog.
*/
protected void dismissDialog() {


 page.onDialog(
         Dialog::dismiss);
}


/**
* Handle dialog with custom action.
*
* Example:
*
* handleDialog(dialog ->
*      dialog.accept());
*/
protected void handleDialog(
     Consumer<Dialog> action) {


 page.onDialog(action);
}



//====================================================
//Popup / New Page Handling
//====================================================


/**
* Wait for popup page.
*
* Example:
*
* Page popup =
*     waitForPopup(() ->
*        click(button));
*/
protected Page waitForPopup(
     Runnable action) {


 Page popup =
         page.waitForPopup(action);


 popup.waitForLoadState();


 return popup;
}



//====================================================
//Upload Handling
//====================================================


/**
* Upload file directly.
*
* Works when input[type=file]
* is available.
*/
protected void uploadFile(
     Locator locator,
     String filePath) {


 validateLocator(locator);


 locator.setInputFiles(
         Path.of(filePath));
}


/**
* Upload using FileChooser.
*
* Useful for custom upload buttons.
*/
protected void uploadFile(
     Runnable action,
     String filePath) {


 FileChooser chooser =
         page.waitForFileChooser(
                 action);


 chooser.setFiles(
         Path.of(filePath));
}



//====================================================
//Download Handling
//====================================================


/**
* Captures downloaded file.
*
* Example:
*
* Download download =
*    downloadFile(() ->
*       click(exportButton));
*/
protected Download downloadFile(
     Runnable action) {


 Download download =
         page.waitForDownload(
                 action);


 return download;
}

/** Captures a download whose server-side report rendering may take longer than the action timeout. */
protected Download downloadFile(
     Runnable action,
     double timeout) {

 Download download = page.waitForDownload(
     new Page.WaitForDownloadOptions().setTimeout(timeout),
     action);
 return download;
}


/**
* Saves downloaded file.
*/
protected void saveDownload(
     Download download,
     String path) {


 download.saveAs(
         Path.of(path));
}
//====================================================
//Oracle ADF Spinner Handling
//====================================================


/**
* Wait until ADF loading spinner disappears.
*
* Adjust locator based on application theme.
*/
protected void waitForADFSpinnerToDisappear() {


 Locator spinner =
         page.locator(
             ".AFBlockingGlassPane");


 try {

     spinner.waitFor(
         new Locator.WaitForOptions()
             .setState(
                 WaitForSelectorState.HIDDEN));

 }
 catch (Exception ignored) {

     // Spinner may not appear
 }
}


/**
* Wait for common loading masks.
*/
protected void waitForLoadingMask() {


 Locator mask =
         page.locator(
             ".loading-mask," +
             ".af_progressIndicator," +
             ".AFBlockingGlassPane");


 try {

     mask.waitFor(
         new Locator.WaitForOptions()
             .setState(
                 WaitForSelectorState.HIDDEN));

 }
 catch(Exception ignored){

 }}
//====================================================
//Toast Handling
//====================================================


/**
* Wait and validate toast message.
*/
protected void waitForToastMessage(
      String message) {


  Locator toast =
          page.getByText(
                  message);


  assertThat(toast)
          .isVisible();
}


/**
* Returns toast locator.
*/
protected Locator getToast(
      String message) {


  return page.getByText(message);
}
 
//====================================================
//ADF Popup Handling
//====================================================


/**
* Returns ADF popup.
*/
protected Locator getADFPopup() {


 return page.locator(
     ".AFPopupWindow");
}


/**
* Wait for popup visibility.
*/
protected void handleADFPopup() {


 Locator popup =
         getADFPopup();


assertThat(popup)
         .isVisible();
}


/**
* Close ADF popup.
*/
protected void closeADFPopup() {


 Locator closeButton =
         getADFPopup()
         .getByRole(
             AriaRole.BUTTON,
             new Locator.GetByRoleOptions().setName("Close"));


 if(closeButton.isVisible()){

     closeButton.click();
 }
}

//====================================================
//Overlay Handling
//====================================================


/**
* Wait until blocking overlay disappears.
*/
protected void waitForOverlayToDisappear() {


 Locator overlay =
         page.locator(
             ".AFBlockingGlassPane," +
             ".overlay," +
             ".modal-backdrop");


 try {

     overlay.waitFor(
         new Locator.WaitForOptions()
         .setState(
             WaitForSelectorState.HIDDEN));

 }
 catch(Exception ignored){

 }
}

//====================================================
//Safe Click
//====================================================


/**
* Enterprise safe click.
*
* Flow:
*
* 1. Wait spinner
* 2. Normal click
* 3. Retry
* 4. Force click last option
*/
protected void safeClick(
     Locator locator) {


 validateLocator(locator);


 waitForADFSpinnerToDisappear();


 try {


     locator.click();


 }
 catch(TimeoutError e){


     waitForOverlayToDisappear();


     locator.click(
         new Locator.ClickOptions()
             .setForce(true));

 }
}

//====================================================
//Retry Click
//====================================================


protected void retryClick(
     Locator locator) {


 int attempts = 3;


 for(int i=1;i<=attempts;i++){


     try{


         safeClick(locator);

         return;


     }
     catch(Exception e){


         if(i==attempts){

             throw e;
         }

     }
 }
}

//====================================================
//Table/Grid Helpers
//====================================================


/**
* Returns row by text.
*/
protected Locator getTableRow(
     String rowText) {


 return page.getByRole(
         AriaRole.ROW,
         new Page.GetByRoleOptions()
         .setName(rowText));
}

/**
 * Click button inside table row.
 */
protected void clickRowAction(
        String rowText,
        String buttonName) {


    Locator row =
            getTableRow(rowText);


    row.getByRole(
            AriaRole.BUTTON,
            new Locator.GetByRoleOptions()
            .setName(buttonName))
       .click();
}

/**
 * Get cell text.
 */
protected String getCellText(
        Locator row,
        int index) {


    return row.locator("td")
            .nth(index)
            .innerText();
}

}
