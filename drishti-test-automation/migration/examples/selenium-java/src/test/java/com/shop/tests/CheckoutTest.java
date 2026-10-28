package com.shop.tests;

import com.shop.base.BaseTest;
import com.shop.pages.InventoryPage;
import com.shop.pages.LoginPage;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.testng.Assert;
import org.testng.annotations.Test;

public class CheckoutTest extends BaseTest {

    private LoginPage loginPage;
    private InventoryPage inventoryPage;

    /** Green banner shown after an order is placed. */
    @FindBy(css = "[data-testid='order-confirmation']")
    private WebElement confirmationBanner;

    @FindBy(id = "checkout")
    private WebElement checkoutButton;

    @Test(description = "A signed-in user can complete checkout", groups = {"regression", "checkout"})
    public void completeCheckout() {
        loginPage = new LoginPage(driver);
        inventoryPage = new InventoryPage(driver);

        loginPage.loginAs("standard_user", "secret_sauce");
        inventoryPage.sortBy("Price (low to high)");
        inventoryPage.addFirstItemToCart();

        JavascriptExecutor js = (JavascriptExecutor) driver;
        js.executeScript("window.scrollTo(0, document.body.scrollHeight)");

        Actions actions = new Actions(driver);
        actions.moveToElement(checkoutButton).click().perform();

        wait.until(ExpectedConditions.visibilityOf(confirmationBanner));
        Assert.assertTrue(confirmationBanner.isDisplayed());
        Assert.assertEquals(confirmationBanner.getText(), "Thank you for your order!");
        Assert.assertEquals(driver.getCurrentUrl(), "https://shop.example.com/checkout-complete");
    }
}
