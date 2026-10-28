@authentication
Feature: Signing in
  As a returning shopper
  I want to sign in to my account
  So that I can see my orders and check out faster

  Background:
    Given I am on the login page
    And I have dismissed the cookie banner

  @smoke
  Scenario: A valid shopper signs in
    When I log in as "standard_user" with password "secret_sauce"
    Then I should see the catalogue
    And the page title should be "Swag Labs"

  Scenario: An unknown shopper is rejected
    When I log in as "nobody" with password "wrong"
    Then I should see the error "Username and password do not match"

  @regression
  Scenario Outline: Rejected credentials
    When I log in as "<username>" with password "<password>"
    Then I should see the error "<message>"

    Examples:
      | username        | password     | message                              |
      | locked_out_user | secret_sauce | Sorry, this user has been locked out. |
      | standard_user   | wrong        | Username and password do not match   |

  Scenario: The sign-in form explains itself
    Then the login button should be visible
    And I should see 3 items in the footer
