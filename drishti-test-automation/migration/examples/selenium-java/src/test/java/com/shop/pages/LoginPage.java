package com.shop.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.How;
import org.openqa.selenium.support.PageFactory;

public class LoginPage {

    private final WebDriver driver;

    /** Username field at the top of the sign-in form. */
    @FindBy(id = "user-name")
    private WebElement usernameInput;

    /** Password field directly below the username. */
    @FindBy(name = "password")
    private WebElement passwordInput;

    @FindBy(css = "[data-testid='login-submit']")
    private WebElement loginButton;

    @FindBy(xpath = "//*[@id='login_button_container']//h3")
    private WebElement errorMessage;

    @FindBy(how = How.CLASS_NAME, using = "login_logo")
    private WebElement logo;

    @FindBy(linkText = "Forgot password?")
    private WebElement forgotPasswordLink;

    private final By cookieBanner = By.cssSelector(".cookie-consent__accept");

    public LoginPage(WebDriver driver) {
        this.driver = driver;
        PageFactory.initElements(driver, this);
    }

    public void loginAs(String username, String password) {
        usernameInput.clear();
        usernameInput.sendKeys(username);
        passwordInput.sendKeys(password);
        loginButton.click();
    }

    public String getErrorText() {
        return errorMessage.getText();
    }

    public void dismissCookies() {
        driver.findElement(cookieBanner).click();
    }
}
