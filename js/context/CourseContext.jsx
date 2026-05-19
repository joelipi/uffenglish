import React, { createContext, useState } from 'react';

// Create and export CourseContext
export const CourseContext = createContext(null);

// Create and export CourseProvider component
export const CourseProvider = ({ children }) => {
    const [courseData, setCourseDataState] = useState({
        configData: null,
        userData: null,
        courseId: null,
        englishLevel: 'A1'
    });

    const setCourseData = (newData) => {
        setCourseDataState((prev) => ({
            ...prev,
            ...newData
        }));
    };

    return (
        <CourseContext.Provider value={{ ...courseData, setCourseData }}>
            {children}
        </CourseContext.Provider>
    );
};
