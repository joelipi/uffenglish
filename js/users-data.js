// Function to add user day class to body

function setupUserDayRestrictions() {
    if (typeof wp_user_data !== 'undefined' && wp_user_data.days_since_registration !== undefined) {
        const days = wp_user_data.days_since_registration;
        
        // Add class to body for CSS targeting
        document.body.classList.add(`user-day-${days}`);
        
        console.log(`User is on day ${days} since registration`);
        
        // Additional JavaScript logic if needed
        handleDaySpecificLogic(days);
    } else {
        // For logged-out users, add a default class
        document.body.classList.add('user-day-guest');
    }
}

// Function for day-specific JavaScript logic
function handleDaySpecificLogic(days) {
    // Example: Hide specific elements based on day
    const elementsToHide = [];
    
    switch(days) {
        case 0: // First day
            elementsToHide.push('.premium-feature', '.advanced-content');
            break;
        case 1: // Second day
            elementsToHide.push('.premium-feature');
            break;
        case 2: // Third day
            elementsToHide.push('.complex-feature');
            break;
        // Add more cases as needed
    }
    
    // Hide elements
    elementsToHide.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            element.style.display = 'none';
        });
    });
}

// Run on page load
document.addEventListener('DOMContentLoaded', function() {
    setupUserDayRestrictions();
});
