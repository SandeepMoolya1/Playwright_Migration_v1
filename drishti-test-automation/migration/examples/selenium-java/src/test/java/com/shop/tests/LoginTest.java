package com.shop.tests;

import com.shop.base.BaseTest;
import com.shop.pages.InventoryPage;
import com.shop.pages.LoginPage;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.testng.Assert;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

public class LoginTest extends BaseTest {

    private LoginPage loginPage;
    private InventoryPage inventoryPage;

    @Test(description = "A valid user can sign in and reach the catalogue", groups = {"smoke"})
    public void validLogin() throws InterruptedException {
        loginPage = new LoginPage(driver);
        inventoryPage = new InventoryPage(driver);

        loginPage.dismissCookies();
        loginPage.loginAs("standard_user", "secret_sauce");

        Thread.sleep(2000);

        Assert.assertEquals(driver.getTitle(), "Swag Labs");
        Assert.assertTrue(inventoryPage.getCartCount() != null);
    }

    @Test(description = "An unknown user sees an error")
    public void invalidLogin() {
        loginPage = new LoginPage(driver);
        loginPage.loginAs("nobody", "wrong");

        wait.until(ExpectedConditions.visibilityOf(loginPage.getErrorText()));
        Assert.assertTrue(loginPage.getErrorText().contains("do not match"));
    }

    @Test(enabled = false, description = "Password reset is not implemented yet")
    public void forgotPassword() {
        loginPage = new LoginPage(driver);
        loginPage.dismissCookies();
    }

    @DataProvider(name = "badCredentials")
    public Object[][] badCredentials() {
        return new Object[][] {{"locked_out_user", "secret_sauce"}, {"", ""}};
    }

    @Test(dataProvider = "badCredentials", description = "Rejected credentials")
    public void rejectedCredentials(String user, String password) {
        loginPage = new LoginPage(driver);
        loginPage.loginAs(user, password);
    }
}
