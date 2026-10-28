package com.shop.pages;

import java.util.List;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.Select;

public class InventoryPage {

    private final WebDriver driver;

    /** Every product card currently shown in the catalogue grid. */
    @FindBy(css = "[data-testid='inventory-item']")
    private List<WebElement> productCards;

    @FindBy(className = "title")
    private WebElement pageTitle;

    /** Sort control in the top right of the catalogue. */
    @FindBy(css = ".product_sort_container")
    private WebElement sortDropdown;

    @FindBy(xpath = "//button[text()='Add to cart']")
    private WebElement addToCartButton;

    @FindBy(id = "shopping_cart_badge")
    private WebElement cartBadge;

    @FindBy(css = "div.inventory_list > div:nth-of-type(3) > div:nth-of-type(2) > span")
    private WebElement thirdItemPrice;

    public InventoryPage(WebDriver driver) {
        this.driver = driver;
        PageFactory.initElements(driver, this);
    }

    public void sortBy(String visibleText) {
        new Select(sortDropdown).selectByVisibleText(visibleText);
    }

    public void addFirstItemToCart() {
        addToCartButton.click();
    }

    public String getCartCount() {
        return cartBadge.getText();
    }
}
