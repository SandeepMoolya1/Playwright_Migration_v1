package com.shop.steps;

import com.shop.pages.InventoryPage;
import com.shop.pages.LoginPage;
import io.cucumber.java.Before;
import io.cucumber.java.en.And;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.testng.Assert;

public class LoginSteps {

    private WebDriver driver;
    private LoginPage loginPage;
    private InventoryPage inventoryPage;

    /** Green catalogue header shown once a shopper is signed in. */
    @FindBy(css = "[data-testid='catalogue-header']")
    private WebElement catalogueHeader;

    /** Every link in the page footer. */
    @FindBy(css = "footer a")
    private java.util.List<WebElement> footerLinks;

    @Given("I am on the login page")
    public void iAmOnTheLoginPage() {
        driver.get("https://shop.example.com/login");
    }

    @And("I have dismissed the cookie banner")
    public void iHaveDismissedTheCookieBanner() {
        loginPage.dismissCookies();
    }

    @When("I log in as {string} with password {string}")
    public void iLogInAs(String username, String password) {
        loginPage.loginAs(username, password);
    }

    @Then("I should see the catalogue")
    public void iShouldSeeTheCatalogue() {
        Assert.assertTrue(catalogueHeader.isDisplayed());
    }

    @Then("the page title should be {string}")
    public void thePageTitleShouldBe(String title) {
        Assert.assertEquals(driver.getTitle(), title);
    }

    @Then("^I should see the error \"([^\"]*)\"$")
    public void iShouldSeeTheError(String message) {
        Assert.assertEquals(loginPage.getErrorText(), message);
    }

    @Then("the login button should be visible")
    public void theLoginButtonShouldBeVisible() {
        Assert.assertTrue(catalogueHeader.isDisplayed());
    }

    @Then("I should see {int} items in the footer")
    public void iShouldSeeItemsInTheFooter(int count) {
        Assert.assertEquals(footerLinks.size(), count);
    }
}
